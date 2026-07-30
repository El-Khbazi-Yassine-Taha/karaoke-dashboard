<?php

namespace App\Services;

use App\Models\Booking;
use App\Models\Reservation;
use App\Models\Room;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class RoomAvailabilityService
{
    public function getDashboardPayload(): array
    {
        $now = Carbon::now();
        $rooms = Room::query()->orderBy('name')->get();

        // Auto no-show before building room status (hospitality grace period)
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
                    : 'FREE NOW',
            ])->all(),
        ];
    }

    /**
     * Mark confirmed reservations as no_show after grace period if guest never checked in.
     * Same pattern hotels/restaurants use — never recorded as paid revenue.
     */
    public function processNoShows(Carbon $now): void
    {
        $grace = Booking::NO_SHOW_GRACE_MINUTES;
        $cutoff = (clone $now)->subMinutes($grace);

        Booking::query()
            ->whereIn('status', ['confirmed', 'pending'])
            ->where('start_time', '<=', $cutoff)
            ->each(function (Booking $booking) {
                $booking->update([
                    'status' => 'no_show',
                    'paid' => false,
                    'payment_method' => null,
                ]);
            });
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

        // Only in_progress sessions occupy the room — confirmed waits for check-in
        $current = $bookings->first(function ($b) use ($now) {
            if ($b->status !== 'in_progress') {
                return false;
            }
            $start = Carbon::parse($b->start_time);

            return $start->lte($now);
        });

        // Waiting for check-in: reservation start has arrived (within grace)
        $awaitingCheckIn = $bookings->first(function ($b) use ($now, $current) {
            if ($current && $b->id === $current->id) {
                return false;
            }
            if (! in_array($b->status, ['confirmed', 'pending'], true)) {
                return false;
            }
            $start = Carbon::parse($b->start_time);
            $graceEnd = (clone $start)->addMinutes(Booking::NO_SHOW_GRACE_MINUTES);

            return $start->lte($now) && $graceEnd->gt($now);
        });

        $upcoming = $bookings->filter(function ($b) use ($current, $awaitingCheckIn, $now) {
            if ($current && $b->id === $current->id) {
                return false;
            }
            if ($awaitingCheckIn && $b->id === $awaitingCheckIn->id) {
                return false;
            }
            if (in_array($b->status, ['completed', 'cancelled', 'no_show'], true)) {
                return false;
            }

            return Carbon::parse($b->end_time)->gt($now);
        })->values();

        // Merge web reservations (agenda-waw) into upcoming for this room
        $webUpcoming = Reservation::query()
            ->where('room_name', $room->name)
            ->whereDate('date', $now->toDateString())
            ->where('check_out', '>', $now)
            ->where('status', 'confirmed')
            ->orderBy('check_in')
            ->get()
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
                'source' => 'reservation',
            ]);

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
                'bookingId' => $current->id,
                'nextClient' => $next?->client_name ?? ($webUpcoming->first()['clientName'] ?? null),
                'freeForMinutesAfter' => $gapMinutes,
                'awaitingCheckIn' => $awaitingCheckIn ? $this->formatBooking($awaitingCheckIn) : null,
                'upcoming' => $upcomingFormatted->all(),
                'headline' => 'Occupied until '.$endTime->format('H:i'),
            ];
        }

        $next = $upcoming->first();
        $nextWeb = $webUpcoming->first();
        $nextStart = $next
            ? Carbon::parse($next->start_time)
            : ($nextWeb ? Carbon::parse($now->toDateString().' '.$nextWeb['start'].':00') : null);
        $freeForSeconds = $nextStart ? $now->diffInSeconds($nextStart) : null;
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
            'awaitingCheckIn' => $awaitingCheckIn ? $this->formatBooking($awaitingCheckIn) : null,
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
            'status' => $isActive ? 'IN_PROGRESS' : strtoupper($booking->status),
            'pushed_minutes' => $pushedMins,
            'originalStart' => $origStart->format('H:i'),
            'source' => 'booking',
        ];
    }
}
