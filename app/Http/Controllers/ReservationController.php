<?php

namespace App\Http\Controllers;

use App\Models\Reservation;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class ReservationController extends Controller
{
    public function update(Request $request, Reservation $reservation)
    {
        $clientName = $request->input('client_name') ?? $request->input('clientName');
        $startClockTime = $request->input('start_clock_time') ?? $request->input('startTime');
        $duration = (int) ($request->input('duration_minutes') ?? $request->input('durationMinutes', 60));

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

        $reservation->update([
            'client_name' => $clientName,
            'check_in' => $newStart,
            'check_out' => $newEnd,
            'date' => $todayDate,
        ]);

        return redirect()->back();
    }

    public function cancel(Reservation $reservation)
    {
        $reservation->update(['status' => 'cancelled']);

        return redirect()->back();
    }
}
