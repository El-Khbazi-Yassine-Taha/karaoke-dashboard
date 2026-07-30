<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

class Room extends Model
{
    protected $fillable = [
        'name',
        'capacity',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'capacity' => 'integer',
        ];
    }

    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class);
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function activeBookings(): HasMany
    {
        return $this->bookings()->where('status', '!=', 'cancelled');
    }

    public function currentBooking(?Carbon $at = null): ?Booking
    {
        $at = $at ?? Carbon::now();

        return $this->activeBookings()
            ->where('start_time', '<=', $at)
            ->where('end_time', '>', $at)
            ->orderBy('start_time')
            ->first();
    }

    public function nextBookingAfter(Carbon $at): ?Booking
    {
        return $this->activeBookings()
            ->where('start_time', '>=', $at)
            ->orderBy('start_time')
            ->first();
    }

    public function upcomingToday(?Carbon $at = null, int $limit = 3)
    {
        $at = $at ?? Carbon::now();

        return $this->activeBookings()
            ->where('end_time', '>', $at)
            ->whereBetween('start_time', [$at->copy()->startOfDay(), $at->copy()->endOfDay()])
            ->orderBy('start_time')
            ->limit($limit)
            ->get();
    }

    /**
     * Calculates the true next available start time slot for a walk-in.
     * Starts NOW if the room is empty, or stacks back-to-back if a session is running.
     */
    public function getNextAvailableStartTime(): Carbon
    {
        $now = Carbon::now();
        
        // 1. If someone is currently occupying the room right now
        $current = $this->currentBooking($now);
        
        if ($current) {
            $loopTime = $current->end_time;
            
            // Look for any consecutive back-to-back bookings connected right to it
            while ($nextConnected = $this->activeBookings()
                ->where('start_time', $loopTime)
                ->whereIn('status', ['confirmed', 'in_progress'])
                ->first()) {
                $loopTime = $nextConnected->end_time;
            }
            
            return $loopTime;
        }

        // 2. If the room is wide open right now, the session starts immediately
        return $now;
    }
}