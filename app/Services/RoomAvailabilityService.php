<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Reservation;
use App\Models\Room;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class RoomAvailabilityService
{
    public function getDashboardPayload(): array
    {
        $now = Carbon::now();
        $rooms = Room::query()->orderBy('name')->get();

        $this->healExpiredSessions($now);
        $this->processNoShows($now);

        $roomPayloads = $rooms->map(fn (Room $room) => $this->getRoomStatus($room, $now));

        $today = Carbon::today();
        $dailyRevenue = Booking::whereDate('start_time', $today)
            ->whereIn('status', ['completed', 'in_progress'])
            ->where('paid', true)
            ->where('is_complimentary', false)
            ->whereNotNull('payment_method')
            ->where('payment_method', '!=', 'complimentary')
            ->sum('total_price');

        $roomRevenues = Booking::whereDate('start_time', $today)
            ->whereIn('status', ['completed', 'in_progress'])
            ->where('paid', true)
            ->where('is_complimentary', false)
            ->whereNotNull('payment_method')
            ->where('payment_method', '!=', 'complimentary')
            ->select('room_id', DB::raw('SUM(total_price) as total'))
            ->groupBy('room_id')
            ->pluck('total', 'room_id');

        return [
            'serverTime' => $now->toIso8601String(),
            'serverTimestamp' => $now->timestamp,
            'dailyRevenue' => (float) $dailyRevenue,
            'roomRevenues' => $roomRevenues,
            'rooms' => $roomPayloads,
            'summary' => $roomPayloads->map(fn ($r) => [
                'room_id' => $r['id'],
                'room_name' => $r['name'],
                'headline' => $r['state'] === 'occupied'
                    ? "Occupied (Frees at {$r['checkoutTime']})"
                    : ($r['state'] === 'awaiting_payment' ? 'Awaiting payment' : 'FREE NOW'),
            ])->all(),
        ];
    }

    /** Complete stuck live sessions whose end time has passed (even if desk UI is closed). */
    public function healExpiredSessions(Carbon $now): void
    {
        Booking::query()
            ->where('status', 'in_progress')
            ->where('end_time', '<=', $now)
            ->each(function (Booking $booking) {
                $booking->update(['status' => 'completed']);
                $this->releaseAgendaBlocksFromNotes((string) $booking->notes);
            });
    }

    /**
     * Mark missed confirmed bookings / web reservations as no_show after grace.
     * Do NOT auto-kill pending walk-ins waiting for payment.
     */
    public function processNoShows(Carbon $now): void
    {
        $grace = Booking::NO_SHOW_GRACE_MINUTES;
        $cutoff = (clone $now)->subMinutes($grace);

        Booking::query()
            ->where('status', 'confirmed')
            ->where('start_time', '<=', $cutoff)
            ->each(function (Booking $booking) {
                $booking->update([
                    'status' => 'no_show',
                    'paid' => false,
                    'payment_method' => null,
                ]);

                $this->releaseAgendaBlocksFromNotes((string) $booking->notes);
            });

        Reservation::query()
            ->where('status', 'confirmed')
            ->where('client_email', '!=', 'desk@waw.local')
            ->where('client_name', 'not like', 'Desk ·%')
            ->where('check_in', '<=', $cutoff)
            ->each(function (Reservation $res) {
                $alreadyStarted = Booking::query()
                    ->where('notes', 'like', '%From web reservation #'.$res->id.'%')
                    ->exists();
                if ($alreadyStarted) {
                    return;
                }

                $res->update([
                    'status' => 'no_show',
                    'payment_status' => 'unpaid',
                ]);

                if ($res->agenda_booking_id) {
                    app(AgendaClient::class)->updateCheckInStatus(
                        (string) $res->agenda_booking_id,
                        'no_show'
                    );
                }
            });
    }

    protected function releaseAgendaBlocksFromNotes(string $notes): void
    {
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
        if ($ids !== []) {
            app(AgendaClient::class)->releaseSlots(array_values(array_unique($ids)));
        }
    }

    public function getRoomStatus(Room $room, Carbon $now): array
    {
        \App\Http\Controllers\BookingController::repairRoomSchedule($room->id);

        $startOfDay = (clone $now)->startOfDay();
        $endOfDay = (clone $now)->endOfDay();

        $bookings = Booking::where('room_id', $room->id)
            ->whereBetween('start_time', [$startOfDay, $endOfDay])
            ->whereNotIn('status', ['cancelled', 'no_show', 'completed'])
            ->orderBy('start_time', 'asc')
            ->get();

        $current = $bookings->first(function ($b) use ($now) {
            if ($b->status !== 'in_progress') {
                return false;
            }
            $start = Carbon::parse($b->start_time);
            $end = Carbon::parse($b->end_time);

            return $start->lte($now) && $end->gt($now);
        });

        // Desk walk-in waiting for payment (timer not started)
        $awaitingPayment = $bookings->first(function ($b) use ($current) {
            if ($current && $b->id === $current->id) {
                return false;
            }

            return $b->status === 'pending';
        });

        $awaitingCheckIn = $bookings->first(function ($b) use ($now, $current, $awaitingPayment) {
            if ($current && $b->id === $current->id) {
                return false;
            }
            if ($awaitingPayment && $b->id === $awaitingPayment->id) {
                return false;
            }
            if ($b->status !== 'confirmed') {
                return false;
            }
            $start = Carbon::parse($b->start_time);
            $graceEnd = (clone $start)->addMinutes(Booking::NO_SHOW_GRACE_MINUTES);

            return $start->lte($now) && $graceEnd->gt($now);
        });

        $upcoming = $bookings->filter(function ($b) use ($current, $awaitingCheckIn, $awaitingPayment, $now) {
            if ($current && $b->id === $current->id) {
                return false;
            }
            if ($awaitingCheckIn && $b->id === $awaitingCheckIn->id) {
                return false;
            }
            if ($awaitingPayment && $b->id === $awaitingPayment->id) {
                return false;
            }
            if (in_array($b->status, ['completed', 'cancelled', 'no_show', 'pending'], true)) {
                return false;
            }

            $start = Carbon::parse($b->start_time);
            $end = Carbon::parse($b->end_time);

            return $start->gt($now) || ($end->gt($now) && $b->status !== 'in_progress');
        })->values();

        $allWebToday = Reservation::query()
            ->where('room_name', $room->name)
            ->whereDate('date', $now->toDateString())
            ->where('status', 'confirmed')
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->orderBy('check_in')
            ->get();

        $dueWeb = $allWebToday->first(function (Reservation $res) use ($now, $room) {
            $alreadyStarted = Booking::query()
                ->where('room_id', $room->id)
                ->where('notes', 'like', '%From web reservation #'.$res->id.'%')
                ->exists();
            if ($alreadyStarted) {
                if ($res->status === 'confirmed') {
                    $res->update(['status' => 'checked_in']);
                }

                return false;
            }

            $checkIn = Carbon::parse($res->check_in);
            $checkOut = Carbon::parse($res->check_out);

            return $checkIn->lte($now) && $checkOut->copy()->addMinutes(30)->gt($now);
        });

        $webUpcoming = $allWebToday
            ->reject(fn (Reservation $res) => $dueWeb && $res->id === $dueWeb->id)
            ->filter(fn (Reservation $res) => Carbon::parse($res->check_out)->gt($now)
                && Carbon::parse($res->check_in)->gt($now))
            ->map(fn (Reservation $res) => [
                'id' => 'web-'.$res->id,
                'clientName' => 'Web · '.$res->client_name,
                'paid' => ($res->payment_status ?? '') === 'paid',
                'paymentMethod' => null,
                'isComplimentary' => false,
                'invitedBy' => null,
                'members' => (int) ($res->members_count ?? 1),
                'start' => Carbon::parse($res->check_in)->format('H:i'),
                'end' => Carbon::parse($res->check_out)->format('H:i'),
                'status' => 'WEB',
                'pushed_minutes' => 0,
                'originalStart' => Carbon::parse($res->check_in)->format('H:i'),
                'source' => $res->source ?? 'agenda-waw',
            ])
            ->values();

        $upcomingFormatted = collect($upcoming->map(fn ($b) => $this->formatBooking($b, $current?->id))->all())
            ->concat($webUpcoming)
            ->sortBy('start')
            ->values();

        if ($current) {
            $next = $upcoming->first() ?? $awaitingCheckIn;
            $gapMinutes = $next
                ? Carbon::parse($current->end_time)->diffInMinutes(Carbon::parse($next->start_time))
                : null;
            $endTime = Carbon::parse($current->end_time);

            return [
                'id' => $room->id,
                'name' => $room->name,
                'capacity' => $room->capacity,
                'state' => 'occupied',
                'currentClient' => $current->client_name,
                'currentClientPaid' => (bool) $current->paid,
                'paymentMethod' => $current->payment_method,
                'isComplimentary' => (bool) $current->is_complimentary,
                'invitedBy' => $current->invited_by,
                'members' => (int) ($current->members_count ?? 1),
                'startTime' => Carbon::parse($current->start_time)->format('H:i'),
                'startTimeIso' => Carbon::parse($current->start_time)->toIso8601String(),
                'checkoutTime' => $endTime->format('H:i'),
                'checkoutTimeIso' => $endTime->toIso8601String(),
                'secondsRemaining' => max(0, $now->diffInSeconds($endTime, false)),
                'durationMinutes' => max(1, (int) ($current->duration_minutes ?: Carbon::parse($current->start_time)->diffInMinutes($endTime))),
                'bookingId' => $current->id,
                'reservationId' => null,
                'nextClient' => $next?->client_name ?? ($webUpcoming->first()['clientName'] ?? null),
                'freeForMinutesAfter' => $gapMinutes,
                'awaitingCheckIn' => $awaitingCheckIn ? $this->formatBooking($awaitingCheckIn) : null,
                'awaitingPayment' => null,
                'awaitingWebPayment' => false,
                'upcoming' => $upcomingFormatted->all(),
                'headline' => 'Occupied until '.$endTime->format('H:i'),
            ];
        }

        // Local pending payment OR due web reservation → payment overlay
        if ($awaitingPayment || $dueWeb) {
            $isWeb = ! $awaitingPayment && $dueWeb;
            $guest = $awaitingPayment;

            return [
                'id' => $room->id,
                'name' => $room->name,
                'capacity' => $room->capacity,
                'state' => 'awaiting_payment',
                'currentClient' => $isWeb ? $dueWeb->client_name : $guest->client_name,
                'currentClientPaid' => false,
                'paymentMethod' => null,
                'isComplimentary' => $isWeb ? false : (bool) $guest->is_complimentary,
                'invitedBy' => $isWeb ? null : $guest->invited_by,
                'members' => $isWeb
                    ? (int) ($dueWeb->members_count ?? 1)
                    : (int) ($guest->members_count ?? 1),
                'startTime' => null,
                'startTimeIso' => null,
                'checkoutTime' => null,
                'checkoutTimeIso' => null,
                'secondsRemaining' => null,
                'bookingId' => $isWeb ? null : $guest->id,
                'reservationId' => $isWeb ? $dueWeb->id : null,
                'nextClient' => $upcoming->first()?->client_name ?? ($webUpcoming->first()['clientName'] ?? null),
                'nextStart' => $upcoming->first()
                    ? Carbon::parse($upcoming->first()->start_time)->format('H:i')
                    : ($webUpcoming->first()['start'] ?? null),
                'awaitingCheckIn' => $awaitingCheckIn ? $this->formatBooking($awaitingCheckIn) : null,
                'awaitingPayment' => true,
                'awaitingWebPayment' => $isWeb,
                'reservedSlot' => $isWeb
                    ? Carbon::parse($dueWeb->check_in)->format('H:i').'–'.Carbon::parse($dueWeb->check_out)->format('H:i')
                    : null,
                'upcoming' => $upcomingFormatted->all(),
                'headline' => $isWeb ? 'Web guest — choose payment' : 'Waiting for payment',
            ];
        }

        $next = $upcoming->first();
        $nextWeb = $webUpcoming->first();
        $nextStart = $next
            ? Carbon::parse($next->start_time)
            : ($nextWeb ? Carbon::parse($now->toDateString().' '.$nextWeb['start'].':00') : null);
        $freeForSeconds = $nextStart ? max(0, $now->diffInSeconds($nextStart, false)) : null;
        $freeForMinutes = $freeForSeconds !== null ? floor($freeForSeconds / 60) : null;
        $freeForSecsOnly = $freeForSeconds !== null ? $freeForSeconds % 60 : null;

        return [
            'id' => $room->id,
            'name' => $room->name,
            'capacity' => $room->capacity,
            'state' => 'free',
            'startTimeIso' => null,
            'freeForMinutes' => $freeForMinutes,
            'freeForSeconds' => $freeForSecsOnly,
            'nextClient' => $next?->client_name ?? ($nextWeb['clientName'] ?? null),
            'nextStart' => $nextStart?->format('H:i'),
            'bookingId' => null,
            'reservationId' => null,
            'awaitingCheckIn' => $awaitingCheckIn ? $this->formatBooking($awaitingCheckIn) : null,
            'awaitingPayment' => null,
            'awaitingWebPayment' => false,
            'upcoming' => $upcomingFormatted->all(),
            'headline' => 'Free Right Now',
        ];
    }

    public function calculateBookingPrice(int $members): float
    {
        if ($members <= 4) {
            return 200.00;
        }

        return 200.00 + (($members - 4) * 40.00);
    }

    private function formatBooking($booking, $currentBookingId = null): array
    {
        $isActive = $currentBookingId && $booking->id === $currentBookingId;
        $origStart = Carbon::parse($booking->original_start_time ?? $booking->start_time);
        $currStart = Carbon::parse($booking->start_time);
        $pushedMins = max(0, $origStart->diffInMinutes($currStart, false));

        return [
            'id' => $booking->id,
            'clientName' => $booking->client_name,
            'paid' => (bool) $booking->paid,
            'paymentMethod' => $booking->payment_method,
            'isComplimentary' => (bool) $booking->is_complimentary,
            'invitedBy' => $booking->invited_by,
            'members' => (int) ($booking->members_count ?? 1),
            'start' => Carbon::parse($booking->start_time)->format('H:i'),
            'end' => Carbon::parse($booking->end_time)->format('H:i'),
            'status' => $isActive
                ? 'IN_PROGRESS'
                : (Carbon::parse($booking->start_time)->gt(Carbon::now()) && $booking->status === 'in_progress'
                    ? 'CONFIRMED'
                    : strtoupper($booking->status)),
            'pushed_minutes' => $pushedMins,
            'originalStart' => $origStart->format('H:i'),
            'source' => 'local',
        ];
    }
}
