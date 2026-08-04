<?php

namespace App\Services;

use App\Models\Reservation;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

class AgendaClient
{
    public function baseUrl(): string
    {
        return rtrim((string) config('services.agenda.url', env('AGENDA_API_URL', 'http://127.0.0.1:3000')), '/');
    }

    public function isConfigured(): bool
    {
        return $this->baseUrl() !== '';
    }

    /**
     * Short timeouts so the staff desk never waits on a cold Vercel function.
     * Sync pulls use a longer budget so tomorrow’s bookings aren’t dropped on cold starts.
     */
    protected function http(bool $forSync = false)
    {
        $request = $forSync
            ? Http::connectTimeout(2)->timeout(4)->acceptJson()
            : Http::connectTimeout(0.5)->timeout(1.2)->acceptJson();
        $apiKey = config('services.agenda.key', env('AGENDA_API_KEY'));
        $pin = config('services.agenda.pin', env('AGENDA_ADMIN_PIN', 'waw2026'));

        $headers = [];
        if ($apiKey) {
            $headers['x-api-key'] = $apiKey;
        }
        if ($pin) {
            $headers['x-admin-pin'] = $pin;
        }

        return $headers ? $request->withHeaders($headers) : $request;
    }

    /**
     * Run Agenda HTTP work without blocking the next desk click.
     * On Windows + `php artisan serve`, afterResponse still holds the worker —
     * spawn a detached `agenda:sync` instead.
     */
    public function defer(callable $callback): void
    {
        dispatch(function () use ($callback) {
            try {
                $callback($this);
            } catch (Throwable $e) {
                Log::warning('Deferred agenda task failed', ['error' => $e->getMessage()]);
            }
        })->afterResponse();
    }

    /**
     * Background pull from agenda-waw (never blocks the HTTP response).
     */
    public function deferSync(?string $date = null): void
    {
        if (PHP_OS_FAMILY === 'Windows') {
            $php = '"'.str_replace('"', '', PHP_BINARY).'"';
            $artisan = '"'.str_replace('"', '', base_path('artisan')).'"';
            $extra = '';
            if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $extra = ' --date='.$date;
            }
            // Detached process — does not block php artisan serve
            pclose(popen('start /B "" '.$php.' '.$artisan.' agenda:sync'.$extra, 'r'));

            return;
        }

        $this->defer(function (AgendaClient $agenda) use ($date) {
            if (is_string($date) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
                $agenda->syncReservations($date);
            } else {
                $agenda->syncUpcomingDays(0, 7);
            }
        });
    }

    /**
     * @return array{date?: string, slots: array{time: string, available: bool, roomsTaken?: int, roomsFree?: int, reason?: string}}
     */
    public function getAvailability(string $date): array
    {
        if (! $this->isConfigured()) {
            return ['date' => $date, 'slots' => []];
        }

        try {
            $response = $this->http()->get(
                $this->baseUrl().'/api/availability?date='.urlencode($date)
            );

            if (! $response->successful()) {
                Log::warning('Agenda availability failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return ['date' => $date, 'slots' => []];
            }

            $data = $response->json();

            return is_array($data) ? $data : ['date' => $date, 'slots' => []];
        } catch (Throwable $e) {
            Log::warning('Agenda availability error', ['error' => $e->getMessage()]);

            return ['date' => $date, 'slots' => []];
        }
    }

    public function isSlotFree(string $date, string $timeSlot, ?int $roomNumber = null): bool
    {
        // Desk speed: trust locally synced web reservations (no Vercel wait).
        if ($roomNumber !== null) {
            return ! $this->isRoomTakenLocally($date, $timeSlot, $roomNumber);
        }

        try {
            $payload = $this->getAvailability($date);
            $slots = $payload['slots'] ?? [];
            if (! is_array($slots)) {
                return true;
            }

            foreach ($slots as $slot) {
                if (! is_array($slot)) {
                    continue;
                }
                if (($slot['time'] ?? '') !== $timeSlot) {
                    continue;
                }

                return (bool) ($slot['available'] ?? false);
            }
        } catch (Throwable $e) {
            Log::warning('Agenda isSlotFree remote skipped', ['error' => $e->getMessage()]);
        }

        return true;
    }

    /**
     * Web guest already holding this room/hour in the local karaoke DB.
     */
    protected function isRoomTakenLocally(string $date, string $timeSlot, int $roomNumber): bool
    {
        try {
            $slotStart = Carbon::createFromFormat(
                'Y-m-d H:i',
                $date.' '.$timeSlot,
                config('app.timezone')
            );
        } catch (Throwable) {
            return false;
        }

        return Reservation::query()
            ->whereDate('date', $date)
            ->whereIn('status', ['confirmed', 'checked_in'])
            ->where('room_name', 'Room '.$roomNumber)
            ->where('check_in', $slotStart)
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->exists();
    }

    protected function isRoomFreeOnAgenda(string $date, string $timeSlot, int $roomNumber): bool
    {
        $bookings = $this->listBookings($date);
        if ($bookings === null) {
            return true; // fail open if agenda unreachable
        }

        foreach ($bookings as $booking) {
            if (! is_array($booking)) {
                continue;
            }
            $status = strtolower((string) ($booking['checkInStatus'] ?? 'pending'));
            if (! in_array($status, ['pending', 'checked_in'], true)) {
                continue;
            }
            if (($booking['timeSlot'] ?? '') !== $timeSlot) {
                continue;
            }
            if ((int) ($booking['roomNumber'] ?? 0) === $roomNumber) {
                return false;
            }
        }

        return true;
    }

    /**
     * Create/block a remote booking on agenda-waw (alias used by walk-ins).
     */
    public function createRemoteBooking(
        string $date,
        string $timeSlot,
        string $clientName,
        int $roomNumber = 1,
        int $participants = 1
    ): ?string {
        return $this->blockSlot($date, $timeSlot, $clientName, $roomNumber, $participants);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function listBookings(?string $date = null): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $url = $this->baseUrl().'/api/bookings';
            if ($date) {
                $url .= '?date='.urlencode($date);
            }

            $response = $this->http(true)->get($url);
            if (! $response->successful()) {
                Log::warning('Agenda sync failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return null;
            }

            $data = $response->json();

            return is_array($data) ? $data : null;
        } catch (Throwable $e) {
            Log::warning('Agenda list error', ['error' => $e->getMessage()]);

            return null;
        }
    }

    public function updateCheckInStatus(string $agendaBookingId, string $checkInStatus, ?string $paymentStatus = null): bool
    {
        if (! $this->isConfigured() || $agendaBookingId === '') {
            return false;
        }

        $payload = ['checkInStatus' => $checkInStatus];
        if ($paymentStatus) {
            $payload['paymentStatus'] = $paymentStatus;
        }

        try {
            $response = $this->http(true)->patch(
                $this->baseUrl().'/api/bookings/'.$agendaBookingId,
                $payload
            );

            if (! $response->successful()) {
                Log::warning('Agenda status push failed', [
                    'id' => $agendaBookingId,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return false;
            }

            return true;
        } catch (Throwable $e) {
            Log::warning('Agenda status push error', [
                'id' => $agendaBookingId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    public function updateRoomNumber(string $agendaBookingId, int $roomNumber): bool
    {
        if (! $this->isConfigured() || $agendaBookingId === '') {
            return false;
        }

        try {
            $response = $this->http()->patch(
                $this->baseUrl().'/api/bookings/'.$agendaBookingId,
                ['roomNumber' => max(1, min(2, $roomNumber))]
            );

            if (! $response->successful()) {
                Log::warning('Agenda room switch failed', [
                    'id' => $agendaBookingId,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return false;
            }

            return true;
        } catch (Throwable $e) {
            Log::warning('Agenda room switch error', [
                'id' => $agendaBookingId,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }

    /**
     * Cancel multiple desk occupancy locks on agenda-waw (frees the hours).
     *
     * @param  array<int, string>  $agendaBookingIds
     */
    public function releaseSlots(array $agendaBookingIds): void
    {
        foreach ($agendaBookingIds as $id) {
            $id = trim((string) $id);
            if ($id === '') {
                continue;
            }
            $this->updateCheckInStatus($id, 'cancelled');
        }
    }

    /**
     * Block a time slot on agenda-waw for a desk booking.
     *
     * @return string|null agenda booking id
     */
    public function blockSlot(
        string $date,
        string $timeSlot,
        string $clientName,
        int $roomNumber = 1,
        int $participants = 1
    ): ?string {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            // Desk locks must survive Vercel cold starts — use sync timeouts.
            $response = $this->http(true)->post($this->baseUrl().'/api/bookings', [
                'clientName' => 'Desk · '.$clientName,
                'phone' => '0000000000',
                'email' => 'desk@waw.local',
                // agenda-waw caps participants at 8 — clamp so desk locks never fail silently
                'participants' => max(1, min(8, $participants)),
                'date' => $date,
                'timeSlot' => $timeSlot,
                'roomNumber' => max(1, min(2, $roomNumber)),
                'fromDesk' => true,
            ]);

            if ($response->status() === 409) {
                // That room is already taken for this hour — the other room may still be free
                return null;
            }

            if (! $response->successful()) {
                Log::warning('Agenda block slot failed', [
                    'slot' => $timeSlot,
                    'room' => $roomNumber,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return null;
            }

            $data = $response->json();
            $id = is_array($data) ? (string) ($data['id'] ?? '') : '';

            if ($id !== '') {
                $this->http(true)->patch(
                    $this->baseUrl().'/api/bookings/'.$id,
                    ['checkInStatus' => 'checked_in']
                );
            }

            return $id !== '' ? $id : null;
        } catch (Throwable $e) {
            Log::warning('Agenda block slot error', [
                'slot' => $timeSlot,
                'room' => $roomNumber,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Block every hour a desk session overlaps (e.g. 20:42–21:42 → 20:00 + 21:00).
     *
     * @return array<int, string> agenda booking ids created
     */
    public function blockOverlappingHours(
        Carbon $start,
        Carbon $end,
        string $clientName,
        int $roomNumber = 1,
        int $participants = 1
    ): array {
        $slots = $this->overlappingHourSlots($start, $end);
        $ids = [];
        $failed = [];

        foreach ($slots as $slot) {
            $id = $this->blockSlot(
                $start->format('Y-m-d'),
                $slot,
                $clientName,
                $roomNumber,
                $participants
            );
            if ($id) {
                $ids[] = $id;
            } else {
                $failed[] = $slot;
            }
        }

        if ($failed !== []) {
            Log::warning('Agenda partial multi-hour lock', [
                'client' => $clientName,
                'room' => $roomNumber,
                'blocked' => $ids,
                'failed_slots' => $failed,
            ]);
        }

        return $ids;
    }

    /**
     * Hour labels (HH:00) that intersect [start, end).
     *
     * @return array<int, string>
     */
    public function overlappingHourSlots(Carbon $start, Carbon $end): array
    {
        if ($end->lte($start)) {
            return [];
        }

        $slots = [];
        $cursor = $start->copy()->minute(0)->second(0);
        while ($cursor->lt($end)) {
            $slots[] = $cursor->format('H').':00';
            $cursor->addHour();
        }

        return $slots;
    }

    protected function mapRemoteStatus(array $booking, ?Reservation $existing): string
    {
        $remote = strtolower((string) ($booking['checkInStatus'] ?? 'pending'));

        return match ($remote) {
            'checked_in' => 'checked_in',
            'no_show' => 'no_show',
            'cancelled' => 'cancelled',
            default => $existing?->status && ! in_array($existing->status, ['confirmed'], true)
                ? $existing->status
                : 'confirmed',
        };
    }

    /** +2120… → +212… (Morocco trunk 0 must not follow country code). */
    protected function normalizePhone(string $raw): string
    {
        $trimmed = trim($raw);
        if ($trimmed === '') {
            return $trimmed;
        }

        $digits = preg_replace('/\D+/', '', $trimmed) ?? '';
        if ($digits === '') {
            return $trimmed;
        }

        if (str_starts_with($digits, '212')) {
            $national = ltrim(substr($digits, 3), '0');

            return '+212'.$national;
        }

        if (preg_match('/^\+(\d{1,3})0+(\d+)$/', $trimmed, $m)) {
            return '+'.$m[1].$m[2];
        }

        return $trimmed;
    }

    /**
     * Pull web bookings day-by-day (today ± range) so Vercel cold starts don’t time out.
     */
    public function syncUpcomingDays(int $fromOffset = 0, int $days = 14): int
    {
        $synced = 0;
        $start = Carbon::today()->addDays($fromOffset);

        for ($i = 0; $i < $days; $i++) {
            $synced += $this->syncReservations($start->copy()->addDays($i)->format('Y-m-d'));
        }

        return $synced;
    }

    /**
     * Pull web bookings into local reservations table for the staff agenda.
     * Also marks local rows cancelled when the client cancelled on the web.
     */
    public function syncReservations(?string $date = null): int
    {
        $bookings = $this->listBookings($date);
        if ($bookings === null) {
            return 0;
        }

        $synced = 0;
        /** @var array<string, true> */
        $activeRemoteIds = [];
        /** @var array<string, true> */
        $seenRemoteIds = [];
        $datesTouched = [];

        foreach ($bookings as $booking) {
            try {
                if (! is_array($booking) || empty($booking['id'])) {
                    continue;
                }

                $remoteId = (string) $booking['id'];
                $seenRemoteIds[$remoteId] = true;

                // Desk occupancy locks are not real web guests — skip agenda UI noise
                $email = strtolower((string) ($booking['email'] ?? ''));
                $name = (string) ($booking['clientName'] ?? '');
                if ($email === 'desk@waw.local' || str_starts_with($name, 'Desk ·')) {
                    continue;
                }

                $remoteStatus = strtolower((string) ($booking['checkInStatus'] ?? 'pending'));
                if (in_array($remoteStatus, ['pending', 'checked_in'], true)) {
                    $activeRemoteIds[$remoteId] = true;
                }

                if (in_array($remoteStatus, ['cancelled', 'no_show'], true)) {
                    $dateStr = (string) ($booking['date'] ?? '');
                    $timeSlot = (string) ($booking['timeSlot'] ?? '');
                    if ($dateStr === '' || $timeSlot === '') {
                        continue;
                    }
                    $datesTouched[$dateStr] = true;

                    $checkIn = Carbon::createFromFormat(
                        'Y-m-d H:i',
                        "{$dateStr} {$timeSlot}",
                        config('app.timezone')
                    );
                    $checkOut = (clone $checkIn)->addHour();
                    $roomNumber = (int) ($booking['roomNumber'] ?? 1);
                    $status = $remoteStatus === 'no_show' ? 'no_show' : 'cancelled';

                    $existing = Reservation::query()
                        ->where('agenda_booking_id', $remoteId)
                        ->first();

                    $payload = [
                        'room_name' => 'Room '.$roomNumber,
                        'client_name' => (string) ($booking['clientName'] ?? 'Client web'),
                        'client_phone' => $this->normalizePhone((string) ($booking['phone'] ?? '')),
                        'client_email' => (string) ($booking['email'] ?? ''),
                        'members_count' => max(1, (int) ($booking['participants'] ?? 1)),
                        'total_price' => isset($booking['totalPrice']) ? (int) $booking['totalPrice'] : null,
                        'payment_status' => (string) ($booking['paymentStatus'] ?? 'not_paid'),
                        'check_in' => $checkIn,
                        'check_out' => $checkOut,
                        'date' => $dateStr,
                        'status' => $status,
                        'source' => 'agenda-waw',
                    ];

                    if ($status === 'cancelled') {
                        if (($existing?->cancel_source) !== 'staff') {
                            $payload['cancel_source'] = 'web';
                        }
                        $payload['cancelled_at'] = $existing?->cancelled_at ?? now();
                    }

                    Reservation::updateOrCreate(
                        ['agenda_booking_id' => $remoteId],
                        $payload
                    );

                    $synced++;
                    continue;
                }

                $dateStr = (string) ($booking['date'] ?? '');
                $timeSlot = (string) ($booking['timeSlot'] ?? '');
                if ($dateStr === '' || $timeSlot === '') {
                    continue;
                }
                $datesTouched[$dateStr] = true;

                $checkIn = Carbon::createFromFormat(
                    'Y-m-d H:i',
                    "{$dateStr} {$timeSlot}",
                    config('app.timezone')
                );
                $checkOut = (clone $checkIn)->addHour();
                $roomNumber = (int) ($booking['roomNumber'] ?? 1);
                $roomName = 'Room '.$roomNumber;

                $existing = Reservation::query()
                    ->where('agenda_booking_id', $remoteId)
                    ->first();

                $status = $this->mapRemoteStatus($booking, $existing);
                if ($existing && in_array($existing->status, ['completed', 'checked_in', 'cancelled', 'no_show'], true)) {
                    if (! in_array($status, ['cancelled', 'no_show'], true)) {
                        $status = $existing->status;
                    }
                }

                Reservation::updateOrCreate(
                    ['agenda_booking_id' => $remoteId],
                    [
                        'room_name' => $roomName,
                        'client_name' => (string) ($booking['clientName'] ?? 'Client web'),
                        'client_phone' => $this->normalizePhone((string) ($booking['phone'] ?? '')),
                        'client_email' => (string) ($booking['email'] ?? ''),
                        'members_count' => max(1, (int) ($booking['participants'] ?? 1)),
                        'total_price' => isset($booking['totalPrice']) ? (int) $booking['totalPrice'] : null,
                        'payment_status' => (string) ($booking['paymentStatus'] ?? 'not_paid'),
                        'check_in' => $checkIn,
                        'check_out' => $checkOut,
                        'date' => $dateStr,
                        'status' => $status,
                        'source' => 'agenda-waw',
                    ]
                );

                $synced++;
            } catch (Throwable $e) {
                Log::warning('Failed to sync agenda booking', [
                    'booking' => $booking['id'] ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Client cancelled on web but local row still "confirmed" → drop from UP NEXT.
        $datesToReconcile = $date
            ? [$date]
            : array_keys($datesTouched);

        if ($datesToReconcile === [] && $date === null) {
            $datesToReconcile = [
                Carbon::today()->format('Y-m-d'),
                Carbon::tomorrow()->format('Y-m-d'),
            ];
        }

        foreach ($datesToReconcile as $day) {
            $synced += $this->cancelLocalWebBookingsMissingRemotely($day, $activeRemoteIds);
        }

        return $synced;
    }

    /**
     * Any local web reservation still "confirmed" whose agenda id is no longer active remotely
     * (cancelled / deleted) must disappear from the desk.
     *
     * @param  array<string, true>  $activeRemoteIds
     */
    protected function cancelLocalWebBookingsMissingRemotely(string $date, array $activeRemoteIds): int
    {
        $locals = Reservation::query()
            ->whereDate('date', $date)
            ->whereNotNull('agenda_booking_id')
            ->whereIn('status', ['confirmed', 'pending'])
            ->where(function ($q) {
                $q->where('source', 'agenda-waw')
                    ->orWhereNotNull('agenda_booking_id');
            })
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->get();

        $count = 0;
        foreach ($locals as $res) {
            $id = (string) $res->agenda_booking_id;
            if ($id !== '' && isset($activeRemoteIds[$id])) {
                continue;
            }

            $res->update([
                'status' => 'cancelled',
                'cancel_source' => $res->cancel_source === 'staff' ? 'staff' : 'web',
                'cancelled_at' => $res->cancelled_at ?? now(),
            ]);
            $count++;
        }

        return $count;
    }

    /**
     * Fast pull of today's (+ tomorrow) web cancels — safe to run on desk polls.
     */
    public function syncRecentCancels(): int
    {
        $n = $this->syncReservations(Carbon::today()->format('Y-m-d'));
        $n += $this->syncReservations(Carbon::tomorrow()->format('Y-m-d'));

        return $n;
    }

    /**
     * Ensure every active desk booking has locked its hour(s) on agenda-waw
     * so the public site shows Complet when both rooms are taken.
     */
    public function pushDeskLocksToAgenda(?string $date = null): int
    {
        $day = $date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)
            ? Carbon::parse($date)->startOfDay()
            : Carbon::today();

        $bookings = \App\Models\Booking::query()
            ->with('room')
            ->whereBetween('start_time', [$day->copy()->startOfDay(), $day->copy()->endOfDay()])
            ->whereIn('status', ['confirmed', 'pending', 'in_progress'])
            ->where(function ($q) {
                $q->whereNull('notes')
                    ->orWhere(function ($q2) {
                        $q2->where('notes', 'not like', '%agenda-blocks:%')
                            ->where('notes', 'not like', '%agenda-block:%')
                            ->where('notes', 'not like', '%From web reservation #%');
                    });
            })
            ->get();

        $pushed = 0;
        $controller = app(\App\Http\Controllers\BookingController::class);

        foreach ($bookings as $booking) {
            try {
                $before = (string) $booking->notes;
                $controller->blockAgendaSlotForBooking($booking->fresh(['room']));
                $booking->refresh();
                if ((string) $booking->notes !== $before && str_contains((string) $booking->notes, 'agenda-blocks:')) {
                    $pushed++;
                }
            } catch (Throwable $e) {
                Log::warning('pushDeskLocksToAgenda failed', [
                    'booking' => $booking->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $pushed;
    }

    /**
     * Cancel remote Desk · locks that no longer match an active local desk booking.
     * Fixes "web says Complet but desk agenda is empty".
     */
    public function releaseOrphanDeskLocks(?string $date = null): int
    {
        $day = $date && preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)
            ? Carbon::parse($date)->toDateString()
            : Carbon::today()->toDateString();

        $remote = $this->listBookings($day);
        if ($remote === null) {
            return 0;
        }

        $activeLocalHours = [];
        \App\Models\Booking::query()
            ->whereDate('start_time', $day)
            ->whereIn('status', ['confirmed', 'pending', 'in_progress'])
            ->with('room')
            ->get()
            ->each(function ($b) use (&$activeLocalHours) {
                $start = Carbon::parse($b->start_time);
                $end = Carbon::parse($b->end_time);
                $room = 1;
                if ($b->room && preg_match('/(\d+)/', (string) $b->room->name, $m)) {
                    $room = (int) $m[1];
                }
                $cursor = $start->copy()->minute(0)->second(0);
                if ($cursor->lt($start)) {
                    // already on the hour
                }
                while ($cursor->lt($end)) {
                    $activeLocalHours[$cursor->format('H:i').'|'.$room] = true;
                    $cursor->addHour();
                }
            });

        // Also release notes-based blocks on cancelled local rows
        $controller = app(\App\Http\Controllers\BookingController::class);
        $stale = \App\Models\Booking::query()
            ->whereDate('start_time', $day)
            ->whereIn('status', ['cancelled', 'completed', 'no_show'])
            ->where(function ($q) {
                $q->where('notes', 'like', '%agenda-blocks:%')
                    ->orWhere('notes', 'like', '%agenda-block:%');
            })
            ->get();

        foreach ($stale as $booking) {
            $controller->releaseAgendaBlocksForBooking($booking);
            $clean = preg_replace('/\s*\|\s*agenda-blocks?:[a-f0-9\-,]+/i', '', (string) $booking->notes) ?? '';
            $booking->update(['notes' => trim($clean, ' |')]);
        }

        $released = $stale->count();

        foreach ($remote as $b) {
            if (! is_array($b)) {
                continue;
            }
            $name = (string) ($b['clientName'] ?? '');
            $email = strtolower((string) ($b['email'] ?? ''));
            $status = strtolower((string) ($b['checkInStatus'] ?? ''));
            if (! ($email === 'desk@waw.local' || str_starts_with($name, 'Desk ·'))) {
                continue;
            }
            if (! in_array($status, ['pending', 'checked_in'], true)) {
                continue;
            }
            $slot = (string) ($b['timeSlot'] ?? '');
            $room = (int) ($b['roomNumber'] ?? 1);
            if (isset($activeLocalHours[$slot.'|'.$room])) {
                continue;
            }
            $id = (string) ($b['id'] ?? '');
            if ($id === '') {
                continue;
            }
            if ($this->updateCheckInStatus($id, 'cancelled')) {
                $released++;
                Log::info('Released orphan desk lock on agenda', [
                    'id' => $id,
                    'slot' => $slot,
                    'room' => $room,
                    'name' => $name,
                ]);
            }
        }

        // Desk marked web guest cancelled/no_show but agenda still "pending" → free the slot.
        $released += $this->pushTerminalWebStatusesToAgenda($day, $remote);

        return $released;
    }

    /**
     * If local reservation is cancelled/no_show but agenda-waw still has pending,
     * push the terminal status so Complet clears / desk and web stay aligned.
     *
     * @param  array<int, mixed>  $remote
     */
    protected function pushTerminalWebStatusesToAgenda(string $day, array $remote): int
    {
        $byId = [];
        foreach ($remote as $b) {
            if (is_array($b) && ! empty($b['id'])) {
                $byId[(string) $b['id']] = $b;
            }
        }

        $locals = Reservation::query()
            ->whereDate('date', $day)
            ->whereNotNull('agenda_booking_id')
            ->whereIn('status', ['cancelled', 'no_show'])
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->get();

        $n = 0;
        foreach ($locals as $res) {
            $id = (string) $res->agenda_booking_id;
            $remoteRow = $byId[$id] ?? null;
            if (! $remoteRow) {
                continue;
            }
            $remoteStatus = strtolower((string) ($remoteRow['checkInStatus'] ?? ''));
            if (! in_array($remoteStatus, ['pending', 'checked_in'], true)) {
                continue;
            }
            $target = $res->status === 'no_show' ? 'no_show' : 'cancelled';
            if ($this->updateCheckInStatus($id, $target)) {
                $n++;
                Log::info('Pushed local terminal status to agenda', [
                    'id' => $id,
                    'status' => $target,
                    'client' => $res->client_name,
                ]);
            }
        }

        return $n;
    }

    /**
     * Visit counts + recent web bookings from agenda-waw (/api/stats).
     *
     * @return array<string, mixed>|null
     */
    public function getSiteStats(): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        try {
            $response = $this->http(true)->get($this->baseUrl().'/api/stats');
            if (! $response->successful()) {
                Log::warning('Agenda stats failed', ['status' => $response->status()]);

                return null;
            }

            $payload = $response->json();

            return is_array($payload) ? $payload : null;
        } catch (Throwable $e) {
            Log::warning('Agenda stats skipped', ['error' => $e->getMessage()]);

            return null;
        }
    }
}
