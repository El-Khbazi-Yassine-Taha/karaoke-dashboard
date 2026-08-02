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
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(
        private RoomAvailabilityService $availability,
        private AgendaClient $agenda,
    ) {
    }

    public function index(Request $request): Response
    {
        // Partial reloads (every desk click) must stay local+fast.
        // Full page load may pull web reservations in the background.
        $isPartial = $request->header('X-Inertia-Partial-Data') !== null;

        if (! $isPartial) {
            $this->syncAgendaQuietly();
        }

        $payload = array_merge($this->availability->getDashboardPayload(! $isPartial), [
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
        $from = Carbon::today()->subDay()->startOfDay();
        $to = Carbon::today()->addDays(14)->endOfDay();

        // Agenda = web reservations only (desk walk-ins stay in Up next / room columns).
        return Reservation::query()
            ->where(function ($q) {
                $q->where('source', 'agenda-waw')
                    ->orWhereNotNull('agenda_booking_id');
            })
            ->where(function ($q) {
                $q->whereNull('client_email')
                    ->orWhere('client_email', '!=', 'desk@waw.local');
            })
            ->where('client_name', 'not like', 'Desk ·%')
            ->whereNotIn('status', ['cancelled', 'no_show'])
            ->whereDate('date', '>=', $from->toDateString())
            ->whereDate('date', '<=', $to->toDateString())
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
                    'source' => 'agenda-waw',
                    'agenda_booking_id' => $res->agenda_booking_id,
                ];
            })
            ->all();
    }

    private function syncAgendaQuietly(): void
    {
        // Never block the dashboard — sync after the response, and keep it small
        // so php artisan serve isn’t busy for the next click.
        if (Cache::has('agenda-sync-throttle')) {
            return;
        }

        Cache::put('agenda-sync-throttle', true, 30);

        $this->agenda->defer(function (AgendaClient $agenda) {
            // Today + tomorrow only (not a full week of Vercel round-trips).
            $agenda->syncUpcomingDays(0, 2);
        });
    }
}
