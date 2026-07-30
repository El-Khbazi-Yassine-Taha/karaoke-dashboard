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
     * @return array<int, array<string, mixed>>
     */
    public function listBookings(?string $date = null): array
    {
        if (! $this->isConfigured()) {
            return [];
        }

        $url = $this->baseUrl().'/api/bookings';
        if ($date) {
            $url .= '?date='.urlencode($date);
        }

        $request = Http::timeout(8)->acceptJson();
        $apiKey = config('services.agenda.key', env('AGENDA_API_KEY'));
        if ($apiKey) {
            $request = $request->withHeaders(['x-api-key' => $apiKey]);
        }

        $response = $request->get($url);
        if (! $response->successful()) {
            Log::warning('Agenda sync failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return [];
        }

        $data = $response->json();

        return is_array($data) ? $data : [];
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
                        'status' => 'confirmed',
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
