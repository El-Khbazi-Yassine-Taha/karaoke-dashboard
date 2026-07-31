<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Validator;
use App\Models\Booking;
use App\Models\Room;

class StoreBookingRequest extends FormRequest
{
    // Business closes at 23:00 — last reservation must END by this time.
    private const CLOSING_CUTOFF = '23:00:00';

    // Max minutes we're allowed to auto-shift a scheduled booking to make room.
    private const MAX_BUFFER_MINUTES = 10;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'client_name' => ['required', 'string', 'max:255'],
            'room_id' => ['required', 'exists:rooms,id'],
            'start_now' => ['required', 'boolean'],
            'start_clock_time' => ['required_if:start_now,false', 'nullable', 'date_format:H:i'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:480'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // When the operator confirms the "push the next reservation back" warning,
            // the frontend resubmits with this set to true.
            'force_buffer' => ['nullable', 'boolean'],
        ];
    }

    public function resolveTimes(): array
    {
        $now = Carbon::now();

        if ($this->boolean('start_now')) {
            $room = Room::find($this->input('room_id'));
            $start = $room ? $room->getNextAvailableStartTime() : $now->copy();
        } else {
            [$hour, $minute] = explode(':', $this->input('start_clock_time'));
            $start = Carbon::parse(Carbon::today()->toDateString()." {$hour}:{$minute}:00");
        }

        $end = $start->copy()->addMinutes((int) $this->input('duration_minutes'));

        return [$start, $end];
    }

    private function closingCutoff(): Carbon
    {
        return Carbon::parse(Carbon::today()->toDateString().' '.self::CLOSING_CUTOFF);
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            [$start, $end] = $this->resolveTimes();
            $now = Carbon::now();

            if (!$this->boolean('start_now') && $start->lt($now->copy()->subMinutes(2))) {
                $validator->errors()->add(
                    'start_clock_time',
                    'That time has already passed today ('.$start->format('H:i').'). Pick "Right Now" or a later time.'
                );
                return;
            }

            // Closing-time rule: nothing may end after 23:00 (we close at 23:00).
            if ($end->gt($this->closingCutoff())) {
                $validator->errors()->add(
                    'duration_minutes',
                    'We close at 23:00, so the last reservation must end by 23:00. Shorten the duration or pick an earlier start.'
                );
                return;
            }

            $roomId = (int) $this->input('room_id');

            // Even "Right now" / walk-ins cannot start a second live session in an occupied room.
            $liveNow = Booking::query()
                ->where('room_id', $roomId)
                ->where('status', 'in_progress')
                ->orderBy('end_time')
                ->first();

            if ($liveNow && $this->boolean('start_now')) {
                // Stacking after the live guest is OK (confirmed for later) — only block
                // if resolveTimes would put the new booking starting while they are still in.
                if ($start->lt($liveNow->end_time)) {
                    $minutesLeft = max(0, $now->diffInMinutes($liveNow->end_time, false));
                    $validator->errors()->add('room_id', sprintf(
                        'This room is occupied by %s until %s (%d min left). Check them out first, or book a later time.',
                        $liveNow->client_name,
                        $liveNow->end_time->format('H:i'),
                        $minutesLeft
                    ));
                }

                return;
            }

            if ($this->boolean('start_now')) {
                return;
            }

            // 1. A room actually occupied right now (in_progress) can NEVER be shifted —
            //    there's a real group inside. Hard block, same as before.
            $liveBlocking = Booking::overlapping($roomId, $start, $end)
                ->where('status', 'in_progress')
                ->orderBy('end_time')
                ->first();

            if ($liveBlocking) {
                $minutesLeft = max(0, $now->diffInMinutes($liveBlocking->end_time, false));
                $validator->errors()->add('room_id', sprintf(
                    'This room is occupied by %s until %s (%d min left). Please wait or pick another room.',
                    $liveBlocking->client_name,
                    $liveBlocking->end_time->format('H:i'),
                    $minutesLeft
                ));
                return;
            }

            // 2. A future SCHEDULED booking (confirmed/pending) overlapping our slot —
            //    this is the "gap squeeze" case that can potentially be shifted.
            $scheduledBlocking = Booking::overlapping($roomId, $start, $end)
                ->whereIn('status', ['confirmed', 'pending'])
                ->orderBy('start_time')
                ->first();

            if (!$scheduledBlocking) {
                return; // clean slot, nothing to do
            }

            // Only handle the "our end pushes into their start" direction — shifting a
            // booking backward in time to fit us in front of it isn't something we do here.
            if ($start->gte($scheduledBlocking->start_time)) {
                $validator->errors()->add('room_id', sprintf(
                    'This room already has %s booked from %s to %s. Pick a different time.',
                    $scheduledBlocking->client_name,
                    $scheduledBlocking->start_time->format('H:i'),
                    $scheduledBlocking->end_time->format('H:i')
                ));
                return;
            }

            $pushMinutes = $end->diffInMinutes($scheduledBlocking->start_time);

            if ($pushMinutes > self::MAX_BUFFER_MINUTES) {
                $validator->errors()->add('room_id', sprintf(
                    'Booking until %s would push %s\'s %s reservation back by %d minutes — more than the %d-min limit. Shorten your duration.',
                    $end->format('H:i'),
                    $scheduledBlocking->client_name,
                    $scheduledBlocking->start_time->format('H:i'),
                    $pushMinutes,
                    self::MAX_BUFFER_MINUTES
                ));
                return;
            }

            // Within the buffer zone (<= 10 min). If not yet confirmed by the operator,
            // signal the frontend to show the "Force with X-Min Buffer" prompt instead
            // of a hard failure.
            if (!$this->boolean('force_buffer')) {
                $validator->errors()->add('buffer_conflict', json_encode([
                    'push_minutes' => $pushMinutes,
                    'next_client' => $scheduledBlocking->client_name,
                    'next_booking_id' => $scheduledBlocking->id,
                    'message' => sprintf(
                        "This pushes into %s's reservation by %d min (under your %d-min limit). Their start time will automatically shift back to keep their full duration intact.",
                        $scheduledBlocking->client_name,
                        $pushMinutes,
                        self::MAX_BUFFER_MINUTES
                    ),
                ]));
                return;
            }

            // Operator confirmed — verify the shift itself doesn't cascade into a problem
            // before actually performing it.
            $shiftedStart = $scheduledBlocking->start_time->copy()->addMinutes($pushMinutes);
            $shiftedEnd = $scheduledBlocking->end_time->copy()->addMinutes($pushMinutes);

            if ($shiftedEnd->gt($this->closingCutoff())) {
                $validator->errors()->add('room_id', sprintf(
                    "Shifting %s's reservation would push it past closing (22:30). Pick an earlier time.",
                    $scheduledBlocking->client_name
                ));
                return;
            }

            $cascadeConflict = Booking::overlapping($roomId, $shiftedStart, $shiftedEnd, $scheduledBlocking->id)
                ->whereIn('status', ['confirmed', 'pending', 'in_progress'])
                ->exists();

            if ($cascadeConflict) {
                $validator->errors()->add('room_id', sprintf(
                    "Shifting %s's reservation would collide with another booking right after it. Pick a different time.",
                    $scheduledBlocking->client_name
                ));
                return;
            }

            // All clear — perform the shift. The new booking itself gets created
            // normally afterward in the controller's store() method.
            $scheduledBlocking->update([
                'start_time' => $shiftedStart,
                'end_time' => $shiftedEnd,
            ]);
        });
    }
}