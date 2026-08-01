<?php

namespace App\Http\Controllers;

use App\Models\Booking;
use App\Models\Reservation;
use App\Models\Room;
use App\Services\AgendaClient;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

class ReservationController extends Controller
{
    public function __construct(private AgendaClient $agenda)
    {
    }

    public function update(Request $request, Reservation $reservation)
    {
        $clientName = $request->input('client_name') ?? $request->input('clientName');
        $startClockTime = $request->input('start_clock_time') ?? $request->input('startTime');
        $duration = (int) ($request->input('duration_minutes') ?? $request->input('durationMinutes', 60));
        $duration = max(0, min(100, $duration));

        $todayDate = $reservation->date
            ? Carbon::parse($reservation->date)->format('Y-m-d')
            : Carbon::now()->format('Y-m-d');
        $newStart = Carbon::parse("{$todayDate} {$startClockTime}");
        $newEnd = (clone $newStart)->addMinutes($duration);

        $closingLimit = Carbon::parse("{$todayDate} 23:00:00");
        if ($newEnd->greaterThan($closingLimit)) {
            return back()->withErrors([
                'duration_minutes' => 'The venue closes at 23:00. This session would end after closing time.',
            ]);
        }

        $oldAgendaId = $reservation->agenda_booking_id
            ? (string) $reservation->agenda_booking_id
            : null;

        $reservation->update([
            'client_name' => $clientName ?: $reservation->client_name,
            'check_in' => $newStart,
            'check_out' => $newEnd,
            'date' => $todayDate,
        ]);

        // Keep agenda-waw in sync after the desk UI already refreshed
        $reservationId = (int) $reservation->id;
        $clientName = (string) $reservation->client_name;
        $roomName = (string) $reservation->room_name;
        $members = (int) ($reservation->members_count ?? 1);
        $startIso = $newStart->toIso8601String();
        $endIso = $newEnd->toIso8601String();

        $this->agenda->defer(function (AgendaClient $agenda) use (
            $reservationId,
            $oldAgendaId,
            $clientName,
            $roomName,
            $members,
            $startIso,
            $endIso
        ) {
            try {
                if ($oldAgendaId) {
                    $agenda->updateCheckInStatus($oldAgendaId, 'cancelled');
                }

                $roomNumber = 1;
                if (preg_match('/(\d+)/', $roomName, $m)) {
                    $roomNumber = (int) $m[1];
                }

                $ids = $agenda->blockOverlappingHours(
                    Carbon::parse($startIso),
                    Carbon::parse($endIso),
                    $clientName,
                    $roomNumber,
                    $members
                );

                if ($ids !== []) {
                    Reservation::where('id', $reservationId)->update([
                        'agenda_booking_id' => $ids[0],
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('Agenda reschedule failed', [
                    'reservation' => $reservationId,
                    'error' => $e->getMessage(),
                ]);
            }
        });

        return redirect()->back();
    }

    public function cancel(Reservation $reservation)
    {
        $reservation->update([
            'status' => 'cancelled',
            'cancel_source' => 'staff',
            'cancelled_at' => now(),
        ]);

        if ($reservation->agenda_booking_id) {
            $agendaId = (string) $reservation->agenda_booking_id;
            $this->agenda->defer(function (AgendaClient $agenda) use ($agendaId) {
                $agenda->updateCheckInStatus($agendaId, 'cancelled');
            });
        }

        return redirect()->back();
    }

    /**
     * Move a web reservation to the other room on the staff dashboard (+ agenda when possible).
     */
    public function switchRoom(Request $request, Reservation $reservation)
    {
        if (! in_array($reservation->status, ['confirmed', 'checked_in'], true)) {
            return back()->withErrors(['room' => 'This reservation cannot be moved.']);
        }

        $targetRoomId = (int) ($request->input('room_id') ?? 0);
        $target = Room::query()->find($targetRoomId);

        if (! $target) {
            return back()->withErrors(['room' => 'Target room not found.']);
        }

        if ((string) $reservation->room_name === (string) $target->name) {
            return back()->withErrors(['room' => 'Reservation is already in that room.']);
        }

        $start = Carbon::parse($reservation->check_in);
        $end = Carbon::parse($reservation->check_out);

        $deskConflict = Booking::query()
            ->where('room_id', $target->id)
            ->whereNotIn('status', ['cancelled', 'no_show', 'completed'])
            ->where('start_time', '<', $end)
            ->where('end_time', '>', $start)
            ->first();

        if ($deskConflict) {
            return back()->withErrors([
                'room' => sprintf(
                    '%s is busy with %s (%s–%s).',
                    $target->name,
                    $deskConflict->client_name,
                    Carbon::parse($deskConflict->start_time)->format('H:i'),
                    Carbon::parse($deskConflict->end_time)->format('H:i')
                ),
            ]);
        }

        $webConflict = Reservation::query()
            ->where('id', '!=', $reservation->id)
            ->where('room_name', $target->name)
            ->whereIn('status', ['confirmed', 'checked_in'])
            ->where('check_in', '<', $end)
            ->where('check_out', '>', $start)
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->first();

        if ($webConflict) {
            return back()->withErrors([
                'room' => sprintf(
                    '%s already has a web reservation for %s.',
                    $target->name,
                    $webConflict->client_name
                ),
            ]);
        }

        $roomNumber = 1;
        if (preg_match('/(\d+)/', $target->name, $m)) {
            $roomNumber = (int) $m[1];
        }

        $reservation->update(['room_name' => $target->name]);

        if ($reservation->agenda_booking_id) {
            $agendaId = (string) $reservation->agenda_booking_id;
            $this->agenda->defer(function (AgendaClient $agenda) use ($agendaId, $roomNumber) {
                $agenda->updateRoomNumber($agendaId, $roomNumber);
            });
        }

        return back()->with('success', sprintf(
            '%s moved to %s.',
            $reservation->client_name,
            $target->name
        ));
    }

    /**
     * Web reservation arrived: choose payment, create a desk booking, start the timer.
     */
    public function startSession(Request $request, Reservation $reservation)
    {
        if ($reservation->status !== 'confirmed') {
            return back()->withErrors(['start' => 'This web reservation cannot be started.']);
        }

        $paid = filter_var($request->input('paid', false), FILTER_VALIDATE_BOOLEAN);
        $paymentMethod = null;

        if ($paid) {
            $request->validate([
                'payment_method' => ['required', Rule::in(Booking::PAYMENT_METHODS)],
            ]);
            $paymentMethod = $request->input('payment_method');
        }

        $room = Room::query()->where('name', $reservation->room_name)->first();
        if (! $room) {
            return back()->withErrors(['start' => 'Room not found for this reservation.']);
        }

        if ($live = Booking::liveSessionInRoom((int) $room->id)) {
            return back()->withErrors([
                'start' => sprintf(
                    'Room is live with %s until %s. Check them out before checking in the web reservation.',
                    $live->client_name,
                    Carbon::parse($live->end_time)->format('H:i')
                ),
            ]);
        }

        $now = Carbon::now();
        $originalStart = Carbon::parse($reservation->check_in);
        $originalEnd = Carbon::parse($reservation->check_out);
        $bookedMinutes = max(15, $originalStart->diffInMinutes($originalEnd));
        $endTime = (clone $now)->addMinutes($bookedMinutes);

        $closingLimit = Carbon::parse($now->format('Y-m-d').' 23:00:00');
        if ($endTime->greaterThan($closingLimit)) {
            $endTime = $closingLimit->copy();
            $bookedMinutes = max(15, $now->diffInMinutes($endTime));
        }

        $members = (int) ($reservation->members_count ?? 1);
        $priceController = app(BookingController::class);
        $totalPrice = $priceController->calculateBookingPrice($members);

        Booking::create([
            'room_id' => $room->id,
            'client_name' => $reservation->client_name,
            'members_count' => $members,
            'total_price' => $totalPrice,
            'original_start_time' => $now,
            'start_time' => $now,
            'end_time' => $endTime,
            'duration_minutes' => $bookedMinutes,
            'status' => 'in_progress',
            'paid' => $paid,
            'payment_method' => $paymentMethod,
            'is_complimentary' => false,
            'notes' => 'From web reservation #'.$reservation->id,
        ]);

        Reservation::where('id', $reservation->id)->update([
            'status' => 'checked_in',
            'payment_status' => $paid ? 'paid' : 'unpaid',
        ]);

        if ($reservation->agenda_booking_id) {
            $agendaId = (string) $reservation->agenda_booking_id;
            $paidFlag = $paid ? 'paid' : 'not_paid';
            $this->agenda->defer(function (AgendaClient $agenda) use ($agendaId, $paidFlag) {
                $agenda->updateCheckInStatus($agendaId, 'checked_in', $paidFlag);
            });
        }

        BookingController::repairRoomSchedule($room->id);

        return redirect()->back();
    }

    /**
     * Mark a due web reservation as no-show (guest never arrived).
     */
    public function markNoShow(Reservation $reservation)
    {
        if ($reservation->status !== 'confirmed') {
            return back()->withErrors(['no_show' => 'Only confirmed web reservations can be marked no-show.']);
        }

        $reservation->update([
            'status' => 'no_show',
            'payment_status' => 'unpaid',
        ]);

        if ($reservation->agenda_booking_id) {
            $agendaId = (string) $reservation->agenda_booking_id;
            $this->agenda->defer(function (AgendaClient $agenda) use ($agendaId) {
                $agenda->updateCheckInStatus($agendaId, 'no_show');
            });
        }

        return redirect()->back();
    }
}
