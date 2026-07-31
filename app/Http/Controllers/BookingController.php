<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Reservation;
use App\Models\Room;
use App\Services\AgendaClient;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class BookingController extends Controller
{
    /**
     * 1–4 members: 200 DHS · 5+: +40 DHS each above 4
     */
    public function calculateBookingPrice(int $members): float
    {
        if ($members <= 4) {
            return 200.00;
        }

        return 200.00 + (($members - 4) * 40.00);
    }

    /**
     * Centralized schedule & cascade engine
     */
    public static function repairRoomSchedule($roomId, bool $dryRun = false): ?array
    {
        $now = Carbon::now();
        $startOfDay = (clone $now)->startOfDay();
        $endOfDay = (clone $now)->endOfDay();

        $allBookings = Booking::where('room_id', $roomId)
            ->whereBetween('start_time', [$startOfDay, $endOfDay])
            ->whereNotIn('status', ['cancelled', 'no_show', 'completed'])
            ->get();

        foreach ($allBookings as $b) {
            if (! $b->original_start_time) {
                $b->update(['original_start_time' => $b->start_time]);
                $b->original_start_time = $b->start_time;
            }
        }

        $activeBooking = $allBookings->first(fn ($b) => $b->status === 'in_progress');

        $runningEnd = $activeBooking ? Carbon::parse($activeBooking->end_time) : null;

        $upcomingBookings = $allBookings
            ->reject(fn ($b) => $activeBooking && $b->id === $activeBooking->id)
            ->filter(fn ($b) => Carbon::parse($b->end_time)->gt($now))
            ->sortBy(fn ($b) => Carbon::parse($b->original_start_time ?? $b->start_time));

        $updates = [];

        foreach ($upcomingBookings as $b) {
            $originalStart = Carbon::parse($b->original_start_time ?? $b->start_time);
            $currentStart = Carbon::parse($b->start_time);
            $durationMinutes = (int) ($b->duration_minutes ?: 60);

            $manualPushMins = min(10, max(0, $originalStart->diffInMinutes($currentStart, false)));
            $desiredStart = (clone $originalStart)->addMinutes($manualPushMins);

            $targetStart = ($runningEnd !== null && $desiredStart->lt($runningEnd))
                ? clone $runningEnd
                : clone $desiredStart;

            $maxAllowedStart = (clone $originalStart)->addMinutes(10);
            if ($targetStart->gt($maxAllowedStart)) {
                return [
                    'ok' => false,
                    'conflictingBooking' => $b,
                    'requiredStart' => $targetStart,
                    'maxAllowedStart' => $maxAllowedStart,
                ];
            }

            $targetEnd = (clone $targetStart)->addMinutes($durationMinutes);

            $updates[] = [
                'booking' => $b,
                'original_start_time' => $originalStart,
                'start_time' => $targetStart,
                'end_time' => $targetEnd,
                'duration_minutes' => $durationMinutes,
            ];

            $runningEnd = $targetEnd;
        }

        if ($dryRun) {
            return ['ok' => true];
        }

        foreach ($updates as $u) {
            $u['booking']->update([
                'original_start_time' => $u['original_start_time'],
                'start_time' => $u['start_time'],
                'end_time' => $u['end_time'],
                'duration_minutes' => $u['duration_minutes'],
            ]);
        }

        return ['ok' => true];
    }

    public function store(Request $request)
    {
        $clientName = $request->input('client_name') ?? $request->input('clientName');
        $roomId = $request->input('room_id') ?? $request->input('roomId');
        $rawStartNow = $request->input('start_now') ?? $request->input('startNow', true);
        $startClockTime = $request->input('start_clock_time') ?? $request->input('startTime') ?? $request->input('time');

        $membersCount = (int) ($request->input('members_count') ?? $request->input('membersCount', 1));
        $isComplimentary = filter_var($request->input('is_complimentary', false), FILTER_VALIDATE_BOOLEAN);
        $invitedBy = $isComplimentary
            ? trim((string) ($request->input('invited_by') ?? ''))
            : null;

        if ($isComplimentary && $invitedBy === '') {
            return back()->withErrors([
                'invited_by' => 'Enter the staff member who invited this guest.',
            ]);
        }

        $totalPrice = $isComplimentary ? 0.0 : $this->calculateBookingPrice($membersCount);
        $isPaid = $isComplimentary
            ? true
            : filter_var($request->input('is_paid', false), FILTER_VALIDATE_BOOLEAN);
        $paymentMethod = $isComplimentary
            ? 'complimentary'
            : null;

        $rawDuration = $request->input('duration_minutes') ?? $request->input('durationMinutes', 60);
        $duration = 60;

        if (is_string($rawDuration)) {
            $val = strtolower(trim($rawDuration));
            if ($val === '30m' || $val === '30') {
                $duration = 30;
            } elseif ($val === '1h' || $val === '60') {
                $duration = 60;
            } elseif ($val === '1.5h' || $val === '90') {
                $duration = 90;
            } elseif ($val === '2h' || $val === '120') {
                $duration = 120;
            } else {
                $duration = (int) filter_var($val, FILTER_SANITIZE_NUMBER_INT) ?: 60;
            }
        } else {
            $duration = (int) $rawDuration;
        }

        $room = Room::findOrFail($roomId);
        $now = Carbon::now();
        $startOfDay = (clone $now)->startOfDay();
        $endOfDay = (clone $now)->endOfDay();
        $todayDate = $now->format('Y-m-d');

        $isStartNow = filter_var($rawStartNow, FILTER_VALIDATE_BOOLEAN)
            || $rawStartNow === '1'
            || $rawStartNow === 'true'
            || empty($startClockTime);

        if ($isStartNow) {
            $latestEnd = Booking::where('room_id', $room->id)
                ->whereBetween('start_time', [$startOfDay, $endOfDay])
                ->whereNotIn('status', ['cancelled', 'no_show', 'completed'])
                ->max('end_time');

            $startTime = ($latestEnd && Carbon::parse($latestEnd)->gt($now))
                ? Carbon::parse($latestEnd)
                : $now;
        } else {
            $timeClean = trim($startClockTime);
            if (strlen($timeClean) === 5) {
                $timeClean .= ':00';
            }
            $startTime = Carbon::parse("{$todayDate} {$timeClean}");
        }

        $endTime = (clone $startTime)->addMinutes($duration);

        $closingLimit = Carbon::parse("{$todayDate} 23:00:00");
        if ($endTime->greaterThan($closingLimit)) {
            return back()->withErrors([
                'duration_minutes' => 'The venue closes at 23:00. This session would end after closing time.',
            ]);
        }

        // Prevent double-booking a web-reserved hour on this room.
        $agenda = app(AgendaClient::class);
        if ($agenda->isConfigured()) {
            $slotHour = $startTime->format('H').':00';
            $roomNumber = 1;
            if (preg_match('/(\d+)/', (string) $room->name, $m)) {
                $roomNumber = (int) $m[1];
            }

            if (! $agenda->isSlotFree($todayDate, $slotHour, $roomNumber)) {
                return back()->withErrors([
                    'start_clock_time' => 'Déjà réservé (web) — ce créneau est pris sur agenda-waw pour cette salle.',
                ]);
            }
        }

        // Walk-ins: wait for payment method before starting the timer.
        // Complimentary can start immediately. Scheduled stays confirmed until check-in.
        if ($isComplimentary && $isStartNow && $startTime->lte($now) && $endTime->gt($now)) {
            $status = 'in_progress';
        } elseif ($isStartNow && $startTime->lte($now) && $endTime->gt($now)) {
            $status = 'pending'; // awaiting payment — timer not started yet
        } else {
            $status = 'confirmed';
        }

        if ($status === 'in_progress' || $status === 'pending') {
            if ($live = Booking::liveSessionInRoom((int) $room->id)) {
                return back()->withErrors([
                    'room_id' => sprintf(
                        'Room is live with %s until %s. Check them out before starting another session.',
                        $live->client_name,
                        Carbon::parse($live->end_time)->format('H:i')
                    ),
                ]);
            }
        }

        $created = Booking::create([
            'room_id' => $room->id,
            'client_name' => $clientName,
            'members_count' => $membersCount,
            'total_price' => $totalPrice,
            'original_start_time' => $startTime,
            'start_time' => $startTime,
            'end_time' => $endTime,
            'duration_minutes' => $duration,
            'status' => $status,
            'paid' => $isPaid,
            'payment_method' => $paymentMethod,
            'is_complimentary' => $isComplimentary,
            'invited_by' => $invitedBy ?: null,
        ]);

        $result = self::repairRoomSchedule($room->id);

        if (! $result['ok']) {
            $created->delete();

            return back()->withErrors([
                'start_clock_time' => "Can't schedule this — {$result['conflictingBooking']->client_name} would need to be pushed more than 10 minutes to make room.",
            ]);
        }

        if (in_array($created->status, ['in_progress', 'confirmed', 'pending'], true)) {
            try {
                $this->blockAgendaSlotForBooking($created->fresh());
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Agenda block after create failed', [
                    'booking' => $created->id,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return redirect()->back();
    }

    public function checkout(Booking $booking)
    {
        $roomId = $booking->room_id;

        $booking->update([
            'end_time' => Carbon::now(),
            'status' => 'completed',
        ]);

        // Linked web reservation → Finished on agenda + keep slot blocked on agenda-waw
        if (preg_match('/From web reservation #(\d+)/', (string) $booking->notes, $m)) {
            $reservation = Reservation::find((int) $m[1]);
            if ($reservation) {
                $reservation->update(['status' => 'completed']);
                if ($reservation->agenda_booking_id) {
                    app(\App\Services\AgendaClient::class)->updateCheckInStatus(
                        (string) $reservation->agenda_booking_id,
                        'checked_in',
                        $booking->paid ? 'paid' : 'not_paid'
                    );
                }
            }
        }

        self::repairRoomSchedule($roomId);

        return redirect()->back();
    }

    /**
     * Staff confirms the guest arrived (hospitality check-in).
     */
    public function checkIn(Booking $booking)
    {
        if (! in_array($booking->status, ['confirmed', 'pending'], true)) {
            return back()->withErrors(['check_in' => 'This booking cannot be checked in.']);
        }

        if ($live = Booking::liveSessionInRoom((int) $booking->room_id, $booking->id)) {
            return back()->withErrors([
                'check_in' => sprintf(
                    'Room is live with %s until %s. Check them out before checking in the next guest.',
                    $live->client_name,
                    Carbon::parse($live->end_time)->format('H:i')
                ),
            ]);
        }

        $now = Carbon::now();
        $duration = (int) ($booking->duration_minutes ?: 60);
        $endTime = (clone $now)->addMinutes($duration);

        $booking->update([
            'status' => 'in_progress',
            'start_time' => $now,
            'end_time' => $endTime,
        ]);

        self::repairRoomSchedule($booking->room_id);

        return redirect()->back();
    }

    /**
     * Choose payment (or unpaid), then start the session timer from now.
     * Used for walk-ins so the clock does not run during the payment prompt.
     */
    public function startSession(Request $request, Booking $booking)
    {
        if (! in_array($booking->status, ['pending', 'confirmed'], true)) {
            return back()->withErrors(['start' => 'This booking cannot be started.']);
        }

        if ($live = Booking::liveSessionInRoom((int) $booking->room_id, $booking->id)) {
            return back()->withErrors([
                'start' => sprintf(
                    'Room is live with %s until %s. Check them out before starting the next session.',
                    $live->client_name,
                    Carbon::parse($live->end_time)->format('H:i')
                ),
            ]);
        }

        $paid = filter_var($request->input('paid', false), FILTER_VALIDATE_BOOLEAN);

        if ($booking->is_complimentary) {
            $paid = true;
            $paymentMethod = 'complimentary';
        } elseif ($paid) {
            $request->validate([
                'payment_method' => ['required', Rule::in(Booking::PAYMENT_METHODS)],
            ]);
            $paymentMethod = $request->input('payment_method');
        } else {
            $paymentMethod = null;
        }

        $now = Carbon::now();
        $duration = (int) ($booking->duration_minutes ?: 60);
        $endTime = (clone $now)->addMinutes($duration);

        $closingLimit = Carbon::parse($now->format('Y-m-d').' 23:00:00');
        if ($endTime->greaterThan($closingLimit)) {
            return back()->withErrors([
                'start' => 'The venue closes at 23:00. This session would end after closing time.',
            ]);
        }

        $booking->update([
            'status' => 'in_progress',
            'start_time' => $now,
            'original_start_time' => $booking->original_start_time ?? $now,
            'end_time' => $endTime,
            'duration_minutes' => $duration,
            'paid' => $paid,
            'payment_method' => $paymentMethod,
        ]);

        // Block this hour on agenda-waw so web guests can't take the same slot.
        // Never fail check-in if agenda-waw is slow/offline.
        try {
            $this->blockAgendaSlotForBooking($booking->fresh());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Agenda block after start-session failed', [
                'booking' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }

        self::repairRoomSchedule($booking->room_id);

        return redirect()->back();
    }

    /**
     * Tell agenda-waw every overlapping hour is taken (Complet on the public site).
     * Example: 20:42–21:42 blocks both 20:00 and 21:00.
     */
    protected function blockAgendaSlotForBooking(Booking $booking): void
    {
        if (str_contains((string) $booking->notes, 'From web reservation #')) {
            return; // already linked to an agenda booking
        }
        if (str_contains((string) $booking->notes, 'agenda-blocks:')
            || str_contains((string) $booking->notes, 'agenda-block:')) {
            return;
        }

        $start = Carbon::parse($booking->start_time);
        $end = Carbon::parse($booking->end_time);
        $room = $booking->room;
        $roomNumber = 1;
        if ($room && preg_match('/(\d+)/', $room->name, $m)) {
            $roomNumber = (int) $m[1];
        }

        $agendaIds = app(AgendaClient::class)->blockOverlappingHours(
            $start,
            $end,
            $booking->client_name,
            $roomNumber,
            (int) ($booking->members_count ?? 1)
        );

        if ($agendaIds !== []) {
            $booking->update([
                'notes' => trim(
                    ($booking->notes ? $booking->notes.' | ' : '')
                    .'agenda-blocks:'.implode(',', $agendaIds)
                ),
            ]);
        }
    }

    /**
     * @return array<int, string>
     */
    protected function agendaBlockIdsFromNotes(?string $notes): array
    {
        $notes = (string) $notes;
        $ids = [];

        if (preg_match('/agenda-blocks:([a-f0-9\-,]+)/i', $notes, $m)) {
            foreach (explode(',', $m[1]) as $id) {
                $id = trim($id);
                if ($id !== '') {
                    $ids[] = $id;
                }
            }
        }

        if (preg_match_all('/agenda-block:([a-f0-9\-]+)/i', $notes, $matches)) {
            foreach ($matches[1] as $id) {
                $ids[] = $id;
            }
        }

        return array_values(array_unique($ids));
    }

    protected function releaseAgendaBlocksForBooking(Booking $booking): void
    {
        $ids = $this->agendaBlockIdsFromNotes($booking->notes);
        if ($ids === []) {
            return;
        }
        app(AgendaClient::class)->releaseSlots($ids);
    }

    /**
     * No-show: guest did not come (or session started by mistake).
     * Never counts as paid revenue in history.
     */
    public function markNoShow(Booking $booking)
    {
        if (! in_array($booking->status, ['confirmed', 'pending', 'in_progress'], true)) {
            return back()->withErrors(['no_show' => 'This booking cannot be marked no-show.']);
        }

        $roomId = $booking->room_id;

        $booking->update([
            'status' => 'no_show',
            'paid' => false,
            'payment_method' => null,
            'is_complimentary' => false,
            'total_price' => 0,
            'end_time' => Carbon::now(),
        ]);

        $this->releaseAgendaBlocksForBooking($booking);

        if (preg_match('/From web reservation #(\d+)/', (string) $booking->notes, $m)) {
            $reservation = Reservation::find((int) $m[1]);
            if ($reservation) {
                $reservation->update(['status' => 'no_show']);
                if ($reservation->agenda_booking_id) {
                    app(AgendaClient::class)->updateCheckInStatus(
                        (string) $reservation->agenda_booking_id,
                        'no_show'
                    );
                }
            }
        }

        self::repairRoomSchedule($roomId);

        return redirect()->back();
    }

    public function delay(Request $request, Booking $booking)
    {
        $requestedMinutes = (int) $request->input('minutes', 10);
        $duration = (int) ($booking->duration_minutes ?: 60);

        if (! $booking->original_start_time) {
            $booking->original_start_time = $booking->start_time;
        }

        $origStart = Carbon::parse($booking->original_start_time);
        $currStart = Carbon::parse($booking->start_time);

        $alreadyPushedMins = max(0, $origStart->diffInMinutes($currStart, false));
        $newPushedMins = max(0, min(10, $alreadyPushedMins + $requestedMinutes));
        $actualAdd = $newPushedMins - $alreadyPushedMins;

        if ($actualAdd === 0) {
            return back()->withErrors([
                'delay' => 'Cannot adjust time further (limit reached or already at baseline).',
            ]);
        }

        $newStart = (clone $origStart)->addMinutes($newPushedMins);
        $newEnd = (clone $newStart)->addMinutes($duration);

        $dateStr = Carbon::parse($booking->start_time)->format('Y-m-d');
        $closingLimit = Carbon::parse("{$dateStr} 23:00:00");
        if ($newEnd->greaterThan($closingLimit)) {
            return back()->withErrors([
                'delay' => 'The venue closes at 23:00. This adjustment would end after closing time.',
            ]);
        }

        $booking->update([
            'original_start_time' => $origStart,
            'start_time' => $newStart,
            'end_time' => $newEnd,
            'duration_minutes' => $duration,
        ]);

        // Move Complet hours on agenda-waw to match the new window
        try {
            $this->releaseAgendaBlocksForBooking($booking);
            $cleanNotes = preg_replace('/\s*\|\s*agenda-blocks?:[a-f0-9\-,]+/i', '', (string) $booking->notes) ?? '';
            $booking->update(['notes' => trim($cleanNotes, " |")]);
            $this->blockAgendaSlotForBooking($booking->fresh());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Agenda re-block after delay failed', [
                'booking' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }

        self::repairRoomSchedule($booking->room_id);

        return redirect()->back();
    }

    public function update(Request $request, Booking $booking)
    {
        $clientName = $request->input('client_name') ?? $request->input('clientName');
        $startClockTime = $request->input('start_clock_time') ?? $request->input('startTime');
        $duration = (int) ($request->input('duration_minutes') ?? $request->input('durationMinutes', 60));
        if ($duration < 1) {
            $duration = 60;
        }

        $now = Carbon::now();
        $todayDate = $now->format('Y-m-d');
        $closingLimit = Carbon::parse("{$todayDate} 23:00:00");

        // Live session: name, start time, and duration are all editable.
        if ($booking->status === 'in_progress') {
            $newStart = Carbon::parse("{$todayDate} {$startClockTime}");
            $newEnd = (clone $newStart)->addMinutes($duration);

            if ($newEnd->lte($now)) {
                $newEnd = (clone $now)->addMinutes(max(15, min($duration, 60)));
            }

            if ($newEnd->greaterThan($closingLimit)) {
                return back()->withErrors([
                    'duration_minutes' => 'The venue closes at 23:00. This session would end after closing time.',
                ]);
            }

            $booking->update([
                'client_name' => $clientName ?: $booking->client_name,
                'start_time' => $newStart,
                'original_start_time' => $booking->original_start_time ?? $newStart,
                'end_time' => $newEnd,
                'duration_minutes' => max(1, (int) $newStart->diffInMinutes($newEnd)),
                'status' => 'in_progress',
            ]);

            try {
                $this->releaseAgendaBlocksForBooking($booking);
                $cleanNotes = preg_replace('/\s*\|\s*agenda-blocks?:[a-f0-9\-,]+/i', '', (string) $booking->notes) ?? '';
                $booking->update(['notes' => trim($cleanNotes, " |")]);
                $this->blockAgendaSlotForBooking($booking->fresh());
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('Agenda re-block after update failed', [
                    'booking' => $booking->id,
                    'error' => $e->getMessage(),
                ]);
            }

            self::repairRoomSchedule($booking->room_id);

            return redirect()->back();
        }

        $newStart = Carbon::parse("{$todayDate} {$startClockTime}");
        $newEnd = (clone $newStart)->addMinutes($duration);

        if ($newEnd->greaterThan($closingLimit)) {
            return back()->withErrors([
                'duration_minutes' => 'The venue closes at 23:00. This session would end after closing time.',
            ]);
        }

        $booking->update([
            'client_name' => $clientName,
            'original_start_time' => $newStart,
            'start_time' => $newStart,
            'end_time' => $newEnd,
            'duration_minutes' => $duration,
        ]);

        try {
            $this->releaseAgendaBlocksForBooking($booking);
            $cleanNotes = preg_replace('/\s*\|\s*agenda-blocks?:[a-f0-9\-,]+/i', '', (string) $booking->notes) ?? '';
            $booking->update(['notes' => trim($cleanNotes, " |")]);
            $this->blockAgendaSlotForBooking($booking->fresh());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Agenda re-block after update failed', [
                'booking' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }

        self::repairRoomSchedule($booking->room_id);

        return redirect()->back();
    }

    /**
     * Add minutes to a live (or upcoming) session without rewriting the start time.
     */
    public function extend(Request $request, Booking $booking)
    {
        $minutes = max(1, min(180, (int) $request->input('minutes', 15)));
        $now = Carbon::now();
        $currentEnd = Carbon::parse($booking->end_time);
        $base = $currentEnd->gt($now) ? $currentEnd : $now;
        $newEnd = (clone $base)->addMinutes($minutes);

        $closingLimit = Carbon::parse($now->format('Y-m-d').' 23:00:00');
        if ($newEnd->greaterThan($closingLimit)) {
            return back()->withErrors([
                'extend' => 'The venue closes at 23:00. Cannot extend past closing time.',
            ]);
        }

        $start = Carbon::parse($booking->start_time);
        $booking->update([
            'end_time' => $newEnd,
            'duration_minutes' => max(1, $start->diffInMinutes($newEnd)),
            'status' => in_array($booking->status, ['confirmed', 'pending'], true)
                ? $booking->status
                : 'in_progress',
        ]);

        try {
            $this->releaseAgendaBlocksForBooking($booking);
            $cleanNotes = preg_replace('/\s*\|\s*agenda-blocks?:[a-f0-9\-,]+/i', '', (string) $booking->notes) ?? '';
            $booking->update(['notes' => trim($cleanNotes, " |")]);
            $this->blockAgendaSlotForBooking($booking->fresh());
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Agenda re-block after extend failed', [
                'booking' => $booking->id,
                'error' => $e->getMessage(),
            ]);
        }

        self::repairRoomSchedule($booking->room_id);

        return redirect()->back();
    }

    public function cancel(Booking $booking)
    {
        $roomId = $booking->room_id;

        $booking->update([
            'status' => 'cancelled',
            'paid' => false,
            'payment_method' => null,
        ]);

        $this->releaseAgendaBlocksForBooking($booking);

        if (preg_match('/From web reservation #(\d+)/', (string) $booking->notes, $m)) {
            $reservation = Reservation::find((int) $m[1]);
            if ($reservation) {
                $reservation->update([
                    'status' => 'cancelled',
                    'cancel_source' => 'staff',
                    'cancelled_at' => now(),
                ]);
                if ($reservation->agenda_booking_id) {
                    app(AgendaClient::class)->updateCheckInStatus(
                        (string) $reservation->agenda_booking_id,
                        'cancelled'
                    );
                }
            }
        }

        self::repairRoomSchedule($roomId);

        return redirect()->back();
    }

    public function togglePaid(Booking $booking, Request $request)
    {
        $paid = $request->has('paid')
            ? filter_var($request->input('paid'), FILTER_VALIDATE_BOOLEAN)
            : ! $booking->paid;

        if ($booking->status === 'no_show') {
            return back()->withErrors(['paid' => 'No-shows cannot be marked as paid.']);
        }

        if ($booking->is_complimentary) {
            $booking->update([
                'paid' => true,
                'payment_method' => 'complimentary',
                'total_price' => 0,
            ]);

            return redirect()->back();
        }

        if ($paid) {
            $request->validate([
                'payment_method' => ['required', Rule::in(Booking::PAYMENT_METHODS)],
            ]);

            $booking->update([
                'paid' => true,
                'payment_method' => $request->input('payment_method'),
            ]);
        } else {
            $booking->update([
                'paid' => false,
                'payment_method' => null,
            ]);
        }

        return redirect()->back();
    }

    /**
     * Today's activity: entered, cancelled, no-shows + payment breakdown.
     */
    public function historyToday(Request $request)
    {
        $dateStr = $request->input('date', Carbon::now()->format('Y-m-d'));
        $day = Carbon::parse($dateStr)->startOfDay();
        $startOfDay = $day->copy()->startOfDay();
        $endOfDay = $day->copy()->endOfDay();

        $mapBooking = function (Booking $b) {
            return [
                'id' => $b->id,
                'clientName' => $b->client_name,
                'roomName' => $b->room->name ?? '—',
                'start' => Carbon::parse($b->start_time)->format('H:i'),
                'end' => Carbon::parse($b->end_time)->format('H:i'),
                'status' => $b->status,
                'members' => (int) ($b->members_count ?? 1),
                'membersCount' => (int) ($b->members_count ?? 1),
                'totalPrice' => (float) $b->total_price,
                'paid' => (bool) $b->paid,
                'paymentMethod' => $b->payment_method,
                'paymentMethodLabel' => $b->paymentMethodLabel(),
                'isComplimentary' => (bool) $b->is_complimentary,
                'invitedBy' => $b->invited_by,
                'collected' => $b->collectedAmount(),
            ];
        };

        $dayQuery = fn () => Booking::with('room')
            ->where(function ($q) use ($startOfDay, $endOfDay) {
                $q->whereBetween('original_start_time', [$startOfDay, $endOfDay])
                    ->orWhere(function ($q2) use ($startOfDay, $endOfDay) {
                        $q2->whereNull('original_start_time')
                            ->whereBetween('start_time', [$startOfDay, $endOfDay]);
                    });
            });

        $entered = $dayQuery()
            ->whereIn('status', ['completed', 'in_progress'])
            ->orderByDesc('start_time')
            ->get()
            ->map($mapBooking);

        $linkedReservationIds = [];

        $deskCancelledBookings = $dayQuery()
            ->where('status', 'cancelled')
            ->orderByDesc('updated_at')
            ->get();

        $deskCancelled = $deskCancelledBookings->map(function (Booking $b) use ($mapBooking, &$linkedReservationIds) {
            $fromWeb = (bool) preg_match('/From web reservation #(\d+)/', (string) $b->notes, $m);
            if ($fromWeb && isset($m[1])) {
                $linkedReservationIds[] = (int) $m[1];
            }

            return array_merge($mapBooking($b), [
                'cancelledAt' => Carbon::parse($b->updated_at)->format('H:i'),
                'cancelSource' => 'staff',
                'cancelLabel' => 'Cancelled by staff',
                'bookedVia' => $fromWeb ? 'web' : 'desk',
                'bookedLabel' => $fromWeb ? 'Booked online' : 'Booked at desk',
            ]);
        });

        $webCancelled = Reservation::query()
            ->where('status', 'cancelled')
            ->whereDate('date', $day->toDateString())
            ->when($linkedReservationIds !== [], fn ($q) => $q->whereNotIn('id', $linkedReservationIds))
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->orderByDesc('updated_at')
            ->get()
            ->map(function (Reservation $r) {
                $cancelSource = $r->cancel_source === 'staff' ? 'staff' : 'web';
                if (! $r->cancel_source && $r->source !== 'agenda-waw') {
                    $cancelSource = 'staff';
                }

                $bookedVia = $r->source === 'agenda-waw' ? 'web' : 'desk';

                return [
                    'id' => 'res-'.$r->id,
                    'clientName' => $r->client_name,
                    'roomName' => $r->room_name ?: '—',
                    'start' => Carbon::parse($r->check_in)->format('H:i'),
                    'end' => Carbon::parse($r->check_out)->format('H:i'),
                    'status' => 'cancelled',
                    'members' => (int) ($r->members_count ?? 1),
                    'membersCount' => (int) ($r->members_count ?? 1),
                    'totalPrice' => (float) ($r->total_price ?? 0),
                    'paid' => false,
                    'paymentMethod' => null,
                    'paymentMethodLabel' => null,
                    'isComplimentary' => false,
                    'invitedBy' => null,
                    'collected' => 0,
                    'cancelledAt' => Carbon::parse($r->cancelled_at ?? $r->updated_at)->format('H:i'),
                    'cancelSource' => $cancelSource,
                    'cancelLabel' => $cancelSource === 'web' ? 'Cancelled on web' : 'Cancelled by staff',
                    'bookedVia' => $bookedVia,
                    'bookedLabel' => $bookedVia === 'web' ? 'Booked online' : 'Booked at desk',
                ];
            });

        $cancelled = $deskCancelled
            ->concat($webCancelled)
            ->sortByDesc(fn ($item) => $item['cancelledAt'] ?? '')
            ->values();

        $noShows = $dayQuery()
            ->where('status', 'no_show')
            ->orderByDesc('start_time')
            ->get()
            ->map($mapBooking);

        $byMethod = [
            'cash' => 0.0,
            'debit_card' => 0.0,
            'carte' => 0.0,
        ];
        $collected = 0.0;
        $pending = 0.0;
        $complimentaryCount = 0;
        $complimentaryValue = 0.0;

        foreach ($entered as $item) {
            if ($item['isComplimentary']) {
                $complimentaryCount++;
                $complimentaryValue += $this->calculateBookingPrice($item['members']);
                continue;
            }
            if ($item['paid'] && $item['paymentMethod'] && isset($byMethod[$item['paymentMethod']])) {
                $byMethod[$item['paymentMethod']] += $item['collected'];
                $collected += $item['collected'];
            } elseif (! $item['paid']) {
                $pending += $item['totalPrice'];
            }
        }

        return response()->json([
            'date' => $day->format('Y-m-d'),
            'entered' => $entered,
            'cancelled' => $cancelled,
            'noShows' => $noShows,
            'totals' => [
                'collected' => $collected,
                'pending' => $pending,
                'potential' => $collected + $pending,
                'byMethod' => $byMethod,
                'complimentaryCount' => $complimentaryCount,
                'complimentaryValue' => $complimentaryValue,
                'noShowCount' => $noShows->count(),
            ],
        ]);
    }

    /**
     * Multi-day revenue summary for end-of-day / manager review.
     */
    public function historyDaily(Request $request)
    {
        $days = max(1, min(60, (int) $request->input('days', 14)));
        $end = Carbon::now()->endOfDay();
        $start = Carbon::now()->subDays($days - 1)->startOfDay();

        $bookings = Booking::with('room')
            ->whereBetween('original_start_time', [$start, $end])
            ->whereNotIn('status', ['cancelled'])
            ->get();

        $byDate = [];

        for ($i = 0; $i < $days; $i++) {
            $d = Carbon::now()->subDays($i)->format('Y-m-d');
            $byDate[$d] = [
                'date' => $d,
                'collected' => 0.0,
                'pending' => 0.0,
                'sessions' => 0,
                'noShows' => 0,
                'complimentary' => 0,
                'byMethod' => [
                    'cash' => 0.0,
                    'debit_card' => 0.0,
                    'carte' => 0.0,
                ],
            ];
        }

        foreach ($bookings as $b) {
            $d = Carbon::parse($b->original_start_time ?? $b->start_time)->format('Y-m-d');
            if (! isset($byDate[$d])) {
                continue;
            }

            if ($b->status === 'no_show') {
                $byDate[$d]['noShows']++;
                continue;
            }

            if (! in_array($b->status, ['completed', 'in_progress'], true)) {
                continue;
            }

            $byDate[$d]['sessions']++;

            if ($b->is_complimentary) {
                $byDate[$d]['complimentary']++;
                continue;
            }

            if ($b->paid && $b->payment_method && isset($byDate[$d]['byMethod'][$b->payment_method])) {
                $amt = (float) $b->total_price;
                $byDate[$d]['byMethod'][$b->payment_method] += $amt;
                $byDate[$d]['collected'] += $amt;
            } elseif (! $b->paid) {
                $byDate[$d]['pending'] += (float) $b->total_price;
            }
        }

        return response()->json([
            'days' => array_values($byDate),
        ]);
    }
}
