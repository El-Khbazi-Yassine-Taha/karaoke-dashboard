<?php

namespace App\Http\Controllers;

use App\Services\AgendaClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AgendaAvailabilityController extends Controller
{
    public function __invoke(Request $request, AgendaClient $agenda): JsonResponse
    {
        $date = (string) $request->query('date', now()->format('Y-m-d'));
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            return response()->json(['error' => 'Invalid date'], 422);
        }

        $payload = $agenda->getAvailability($date);
        $slots = is_array($payload['slots'] ?? null) ? $payload['slots'] : [];

        $time = $request->query('time');
        if (is_string($time) && $time !== '') {
            $match = null;
            foreach ($slots as $slot) {
                if (is_array($slot) && ($slot['time'] ?? '') === $time) {
                    $match = $slot;
                    break;
                }
            }

            $available = is_array($match) ? (bool) ($match['available'] ?? false) : true;
            $label = $available ? 'Libre' : 'Déjà réservé';

            return response()->json([
                'date' => $date,
                'time' => $time,
                'available' => $available,
                'label' => $label,
                'slot' => $match,
                'slots' => $slots,
            ]);
        }

        return response()->json([
            'date' => $date,
            'slots' => $slots,
        ]);
    }
}
