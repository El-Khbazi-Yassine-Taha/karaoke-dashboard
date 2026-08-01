<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreBookingRequest;
use App\Models\Booking;
use App\Models\Reservation;
use App\Services\AgendaClient;
use App\Services\RoomAvailabilityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(
        private RoomAvailabilityService $availability,
        private AgendaClient $agenda,
    ) {
    }

    public function index(): Response
    {
        $this->syncAgendaQuietly();

        $payload = array_merge($this->availability->getDashboardPayload(true), [
            'reservations' => $this->reservationsPayload(),
        ]);

        return Inertia::render('Dashboard', $payload);
    }

    /**
     * Lightweight JSON polling endpoint
     */
    public function status(): JsonResponse
    {
        // Polls must stay fast — skip agenda sync + schedule repair (mutations already repair).
        $payload = array_merge($this->availability->getDashboardPayload(false), [
            'reservations' => $this->reservationsPayload(),
        ]);

        return response()->json($payload);
    }

    public function store(StoreBookingRequest $request): RedirectResponse
    {
        [$start, $end] = $request->resolveTimes();

        Booking::create([
            'room_id' => $request->input('room_id'),
            'client_name' => $request->input('client_name'),
            'start_time' => $start,
            'original_start_time' => $start,
            'end_time' => $end,
            'status' => $request->boolean('start_now') ? 'in_progress' : 'confirmed',
            'notes' => $request->input('notes'),
        ]);

        return back()->with('success', 'Booking created.');
    }

    /**
     * Manually check out active session
     */
    public function checkout(Booking $booking): RedirectResponse
    {
        $booking->update([
            'end_time' => Carbon::now(),
            'status' => 'completed',
        ]);

        return back()->with('success', 'Room checked out and is now free.');
    }

    private function reservationsPayload(): array
    {
        return Reservation::query()
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->whereDate('date', '>=', Carbon::today()->subDay())
            ->orderBy('check_in', 'asc')
            ->get()
            ->map(function (Reservation $res) {
                return [
                    'id' => $res->id,
                    'room_name' => $res->room_name,
                    'client_name' => $res->client_name,
                    'client_phone' => $res->client_phone,
                    'client_email' => $res->client_email,
                    'members_count' => $res->members_count,
                    'total_price' => $res->total_price,
                    'payment_status' => $res->payment_status,
                    'check_in' => optional($res->check_in)->format('Y-m-d H:i:s'),
                    'check_out' => optional($res->check_out)->format('Y-m-d H:i:s'),
                    'date' => optional($res->date)->format('Y-m-d'),
                    'status' => $res->status,
                    'source' => $res->source,
                    'agenda_booking_id' => $res->agenda_booking_id,
                ];
            })
            ->all();
    }

    private function syncAgendaQuietly(): void
    {
        // Never block the dashboard HTML/JSON on Vercel — sync after the response.
        if (Cache::has('agenda-sync-throttle')) {
            return;
        }

        Cache::put('agenda-sync-throttle', true, 45);

        $this->agenda->defer(function (AgendaClient $agenda) {
            $agenda->syncReservations();
        });
    }
}
