<?php

namespace App\Http\Controllers;

use App\Models\Reservation;
use App\Services\AgendaClient;
use Illuminate\Support\Carbon;
use Inertia\Inertia;
use Inertia\Response;

class AdminWebController extends Controller
{
    public function index(AgendaClient $agenda): Response
    {
        $remote = $agenda->getSiteStats();
        $now = Carbon::now(config('app.timezone'));

        $localBookings = Reservation::query()
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->orderByDesc('check_in')
            ->limit(200)
            ->get()
            ->map(function (Reservation $r) use ($now) {
                $checkIn = $r->check_in ? Carbon::parse($r->check_in)->timezone(config('app.timezone')) : null;
                $checkOut = $r->check_out
                    ? Carbon::parse($r->check_out)->timezone(config('app.timezone'))
                    : ($checkIn ? $checkIn->copy()->addHour() : null);
                $date = $r->date
                    ? Carbon::parse($r->date)->format('Y-m-d')
                    : ($checkIn?->format('Y-m-d') ?? '—');

                return $this->normalizeBookingRow([
                    'id' => $r->id,
                    'clientName' => $r->client_name,
                    'phone' => $r->client_phone,
                    'email' => $r->client_email,
                    'participants' => (int) ($r->members_count ?? 1),
                    'totalPrice' => (float) ($r->total_price ?? 0),
                    'date' => $date,
                    'timeSlot' => $checkIn?->format('H:i') ?? '—',
                    'end' => $checkOut?->format('H:i'),
                    'roomName' => $r->room_name ?: '—',
                    'status' => $r->status,
                    'paymentStatus' => $r->payment_status,
                    'source' => $r->source ?? 'web',
                    'createdAt' => $r->created_at?->toIso8601String(),
                    'startsAt' => $checkIn?->toIso8601String(),
                    'endsAt' => $checkOut?->toIso8601String(),
                ], $now);
            })
            ->filter(fn ($b) => $b !== null)
            ->values()
            ->all();

        $remoteBookings = [];
        if (is_array($remote['recentBookings'] ?? null)) {
            foreach ($remote['recentBookings'] as $b) {
                if (! is_array($b)) {
                    continue;
                }
                $name = (string) ($b['clientName'] ?? '');
                $email = strtolower((string) ($b['email'] ?? ''));
                if ($email === 'desk@waw.local' || str_starts_with($name, 'Desk ·')) {
                    continue;
                }

                $date = (string) ($b['date'] ?? '—');
                $timeSlot = (string) ($b['timeSlot'] ?? '—');
                $start = null;
                $end = null;
                if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) && preg_match('/^\d{2}:\d{2}$/', $timeSlot)) {
                    $start = Carbon::createFromFormat(
                        'Y-m-d H:i',
                        $date.' '.$timeSlot,
                        config('app.timezone')
                    );
                    $end = $start->copy()->addHour();
                }

                $row = $this->normalizeBookingRow([
                    'id' => $b['id'] ?? null,
                    'clientName' => $name !== '' ? $name : '—',
                    'phone' => $b['phone'] ?? null,
                    'email' => $b['email'] ?? null,
                    'participants' => (int) ($b['participants'] ?? 1),
                    'totalPrice' => (float) ($b['totalPrice'] ?? 0),
                    'date' => $date,
                    'timeSlot' => $timeSlot,
                    'end' => $end?->format('H:i'),
                    'roomName' => isset($b['roomNumber']) ? 'Room '.$b['roomNumber'] : '—',
                    'status' => $b['checkInStatus'] ?? 'pending',
                    'paymentStatus' => $b['paymentStatus'] ?? null,
                    'source' => 'agenda-waw',
                    'createdAt' => $b['createdAt'] ?? null,
                    'startsAt' => $start?->toIso8601String(),
                    'endsAt' => $end?->toIso8601String(),
                ], $now);

                if ($row) {
                    $remoteBookings[] = $row;
                }
            }
        }

        // Prefer live agenda list when available; fall back to synced local rows.
        $bookings = $remoteBookings !== [] ? $remoteBookings : $localBookings;

        usort($bookings, function ($a, $b) {
            return strcmp((string) ($b['startsAt'] ?? $b['date']), (string) ($a['startsAt'] ?? $a['date']));
        });

        $upcoming = collect($bookings)->where('displayStatus', 'upcoming')->count();
        $passed = collect($bookings)->where('displayStatus', 'passed')->count();
        $cancelled = collect($bookings)->where('displayStatus', 'cancelled')->count();

        return Inertia::render('Admin/WebInsights', [
            'visits' => [
                'total' => (int) ($remote['visitsTotal'] ?? 0),
                'today' => (int) ($remote['visitsToday'] ?? 0),
                'last7Days' => (int) ($remote['visitsLast7Days'] ?? 0),
                'byDay' => is_array($remote['visitsByDay'] ?? null) ? $remote['visitsByDay'] : [],
                'available' => $remote !== null,
            ],
            'bookings' => array_values($bookings),
            'bookingsTotal' => count($bookings),
            'bookingsPending' => $upcoming,
            'bookingsPassed' => $passed,
            'bookingsCancelled' => $cancelled,
            'source' => $remoteBookings !== [] ? 'live' : 'local',
            'serverNow' => $now->toIso8601String(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    protected function normalizeBookingRow(array $row, Carbon $now): ?array
    {
        $name = (string) ($row['clientName'] ?? '');
        $email = strtolower((string) ($row['email'] ?? ''));
        if ($email === 'desk@waw.local' || str_starts_with($name, 'Desk ·')) {
            return null;
        }

        $raw = strtolower((string) ($row['status'] ?? 'pending'));
        $start = ! empty($row['startsAt']) ? Carbon::parse($row['startsAt']) : null;
        $end = ! empty($row['endsAt']) ? Carbon::parse($row['endsAt']) : null;

        if (! $row['end'] && $start) {
            $row['end'] = $start->copy()->addHour()->format('H:i');
            $end = $start->copy()->addHour();
        }

        // Upcoming = web guest, not cancelled, session not started yet.
        // Passed = was upcoming but start (or end) already went by.
        if (in_array($raw, ['cancelled'], true)) {
            $display = 'cancelled';
        } elseif (in_array($raw, ['no_show'], true)) {
            $display = 'no_show';
        } elseif (in_array($raw, ['checked_in', 'completed'], true)) {
            $display = 'checked_in';
        } elseif (in_array($raw, ['pending', 'confirmed'], true)) {
            // Upcoming = web booking whose start is still in the future (guest not here yet).
            // Once the start time has passed without check-in → Passed.
            if ($start && $start->gt($now)) {
                $display = 'upcoming';
            } else {
                $display = 'passed';
            }
        } else {
            $display = $raw ?: 'passed';
        }

        $row['displayStatus'] = $display;
        $row['whenLabel'] = trim(sprintf(
            '%s · %s%s',
            $row['date'] ?? '—',
            $row['timeSlot'] ?? '—',
            ! empty($row['end']) ? '–'.$row['end'] : ''
        ));

        return $row;
    }
}
