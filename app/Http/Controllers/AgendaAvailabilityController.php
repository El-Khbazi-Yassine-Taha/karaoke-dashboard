<?php

namespace App\Http\Controllers;

use App\Models\Reservation;
use App\Services\AgendaClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class AgendaAvailabilityController extends Controller
{
    public function __invoke(Request $request, AgendaClient $agenda): JsonResponse
    {
        $date = (string) $request->query('date', now()->format('Y-m-d'));
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return response()->json(['error' => 'Invalid date'], 422);
        }

        $time = $request->query('time');
        if (is_string($time) && $time !== '') {
            // Local-first (synced web bookings) — desk modal must not wait on Vercel.
            $available = $this->isHourFreeLocally($date, $time);
            $label = $available ? 'Libre' : 'Déjà réservé';

            return response()->json([
                'date' => $date,
                'time' => $time,
                'available' => $available,
                'label' => $label,
                'slot' => [
                    'time' => $time,
                    'available' => $available,
                ],
                'slots' => [],
            ]);
        }

        // Full-day list is rarely needed by the modal; keep remote but short-timeout via AgendaClient.
        $payload = $agenda->getAvailability($date);
        $slots = is_array($payload['slots'] ?? null) ? $payload['slots'] : [];

        return response()->json([
            'date' => $date,
            'slots' => $slots,
        ]);
    }

    protected function isHourFreeLocally(string $date, string $time): bool
    {
        try {
            $slotStart = Carbon::createFromFormat(
                'Y-m-d H:i',
                $date.' '.$time,
                config('app.timezone')
            );
        } catch (\Throwable) {
            return true;
        }

        $taken = Reservation::query()
            ->whereDate('date', $date)
            ->whereIn('status', ['confirmed', 'checked_in'])
            ->where('check_in', $slotStart)
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->count();

        // Two karaoke rooms on the public agenda
        return $taken < 2;
    }
}
