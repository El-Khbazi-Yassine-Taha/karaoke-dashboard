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
     */
    protected function http()
    {
        $request = Http::connectTimeout(0.8)->timeout(1.5)->acceptJson();
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
     * Run Agenda HTTP work after the browser already got the redirect (desk stays snappy).
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
        foreach ($this->listBookings($date) as $booking) {
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
    public function listBookings(?string $date = null): array
    {
        if (! $this->isConfigured()) {
            return [];
        }

        try {
            $url = $this->baseUrl().'/api/bookings';
            if ($date) {
                $url .= '?date='.urlencode($date);
            }

            $response = $this->http()->get($url);
            if (! $response->successful()) {
                Log::warning('Agenda sync failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return [];
            }

            $data = $response->json();

            return is_array($data) ? $data : [];
        } catch (Throwable $e) {
            Log::warning('Agenda list error', ['error' => $e->getMessage()]);

            return [];
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
            $response = $this->http()->patch(
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
            $response = $this->http()->post($this->baseUrl().'/api/bookings', [
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
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);

                return null;
            }

            $data = $response->json();
            $id = is_array($data) ? (string) ($data['id'] ?? '') : '';

            if ($id !== '') {
                $this->updateCheckInStatus($id, 'checked_in');
            }

            return $id !== '' ? $id : null;
        } catch (Throwable $e) {
            Log::warning('Agenda block slot error', [
                'slot' => $timeSlot,
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

    /**
     * Pull web bookings into local reservations table for the staff agenda.
     */
    public function syncReservations(?string $date = null): int
    {
        $bookings = $this->listBookings($date);
        $synced = 0;

        foreach ($bookings as $booking) {
            try {
                if (! is_array($booking) || empty($booking['id'])) {
                    continue;
                }

                // Desk occupancy locks are not real web guests — skip agenda UI noise
                $email = strtolower((string) ($booking['email'] ?? ''));
                $name = (string) ($booking['clientName'] ?? '');
                if ($email === 'desk@waw.local' || str_starts_with($name, 'Desk ·')) {
                    continue;
                }

                $remoteStatus = strtolower((string) ($booking['checkInStatus'] ?? 'pending'));
                if (in_array($remoteStatus, ['cancelled', 'no_show'], true)) {
                    $dateStr = (string) ($booking['date'] ?? '');
                    $timeSlot = (string) ($booking['timeSlot'] ?? '');
                    if ($dateStr === '' || $timeSlot === '') {
                        continue;
                    }

                    $checkIn = Carbon::createFromFormat(
                        'Y-m-d H:i',
                        "{$dateStr} {$timeSlot}",
                        config('app.timezone')
                    );
                    $checkOut = (clone $checkIn)->addHour();
                    $roomNumber = (int) ($booking['roomNumber'] ?? 1);
                    $status = $remoteStatus === 'no_show' ? 'no_show' : 'cancelled';

                    $existing = Reservation::query()
                        ->where('agenda_booking_id', (string) $booking['id'])
                        ->first();

                    $payload = [
                        'room_name' => 'Room '.$roomNumber,
                        'client_name' => (string) ($booking['clientName'] ?? 'Client web'),
                        'client_phone' => (string) ($booking['phone'] ?? ''),
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
                        // Don't overwrite a staff cancel with "web"
                        if (($existing?->cancel_source) !== 'staff') {
                            $payload['cancel_source'] = 'web';
                        }
                        $payload['cancelled_at'] = $existing?->cancelled_at ?? now();
                    }

                    Reservation::updateOrCreate(
                        ['agenda_booking_id' => (string) $booking['id']],
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

                $checkIn = Carbon::createFromFormat(
                    'Y-m-d H:i',
                    "{$dateStr} {$timeSlot}",
                    config('app.timezone')
                );
                $checkOut = (clone $checkIn)->addHour();
                $roomNumber = (int) ($booking['roomNumber'] ?? 1);
                $roomName = 'Room '.$roomNumber;

                $existing = Reservation::query()
                    ->where('agenda_booking_id', (string) $booking['id'])
                    ->first();

                $status = $this->mapRemoteStatus($booking, $existing);
                if ($existing && in_array($existing->status, ['completed', 'checked_in', 'cancelled', 'no_show'], true)) {
                    if (! in_array($status, ['cancelled', 'no_show'], true)) {
                        $status = $existing->status;
                    }
                }

                Reservation::updateOrCreate(
                    ['agenda_booking_id' => (string) $booking['id']],
                    [
                        'room_name' => $roomName,
                        'client_name' => (string) ($booking['clientName'] ?? 'Client web'),
                        'client_phone' => (string) ($booking['phone'] ?? ''),
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

        return $synced;
    }
}
