<?php

namespace Database\Seeders;

use App\Models\Booking;
use App\Models\Reservation;
use Illuminate\Database\Seeder;

/**
 * Clears demo / fake desk bookings and agenda reservations.
 * Real data comes from walk-ins and Calendly webhooks only.
 */
class DemoBookingSeeder extends Seeder
{
    public function run(): void
    {
        Booking::query()
            ->whereIn('client_name', [
                'Walk-in Group A',
                'Phone Reservation - Malik',
                'Corporate Team',
            ])
            ->delete();

        // Remove any leftover seed-style agenda rows so the agenda stays empty until Calendly syncs
        Reservation::query()
            ->whereIn('client_name', [
                'Walk-in Group A',
                'Phone Reservation - Malik',
                'Corporate Team',
            ])
            ->delete();
    }
}
