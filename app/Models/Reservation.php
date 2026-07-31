<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Reservation extends Model
{
    use HasFactory;

    protected $fillable = [
        'room_name',
        'client_name',
        'client_phone',
        'client_email',
        'members_count',
        'total_price',
        'payment_status',
        'check_in',
        'check_out',
        'date',
        'status',
        'cancel_source',
        'cancelled_at',
        'calendly_uuid',
        'agenda_booking_id',
        'source',
    ];

    protected function casts(): array
    {
        return [
            'check_in' => 'datetime',
            'check_out' => 'datetime',
            'cancelled_at' => 'datetime',
            'date' => 'date',
            'members_count' => 'integer',
        ];
    }
}
