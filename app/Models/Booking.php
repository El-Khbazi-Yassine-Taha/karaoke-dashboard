<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Booking extends Model
{
    public const BLOCKING_STATUSES = [
        'pending',
        'confirmed',
        'in_progress',
    ];

    public const PAYMENT_METHODS = [
        'cash',
        'debit_card',
        'carte',
    ];

    public const PAYMENT_METHOD_LABELS = [
        'cash' => 'Cash',
        'debit_card' => 'Debit card',
        'carte' => 'Carte',
        'complimentary' => 'Complimentary',
    ];

    /** Grace period after reservation start before auto no-show (industry standard). */
    public const NO_SHOW_GRACE_MINUTES = 15;

    protected $fillable = [
        'room_id',
        'client_name',
        'members_count',
        'total_price',
        'start_time',
        'end_time',
        'original_start_time',
        'duration_minutes',
        'status',
        'paid',
        'payment_method',
        'is_complimentary',
        'invited_by',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'start_time' => 'datetime',
            'end_time' => 'datetime',
            'original_start_time' => 'datetime',
            'paid' => 'boolean',
            'is_complimentary' => 'boolean',
            'members_count' => 'integer',
            'total_price' => 'decimal:2',
            'duration_minutes' => 'integer',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function paymentMethodLabel(): string
    {
        if ($this->is_complimentary) {
            return self::PAYMENT_METHOD_LABELS['complimentary'];
        }

        return self::PAYMENT_METHOD_LABELS[$this->payment_method] ?? '—';
    }

    public function collectedAmount(): float
    {
        if ($this->is_complimentary || ! $this->paid || in_array($this->status, ['cancelled', 'no_show'], true)) {
            return 0.0;
        }

        return (float) $this->total_price;
    }

    public function scopeBlocking(Builder $query): Builder
    {
        return $query->whereIn('status', self::BLOCKING_STATUSES);
    }

    public function scopeOverlapping(
        Builder $query,
        int $roomId,
        CarbonInterface $startTime,
        CarbonInterface $endTime,
        ?int $excludeId = null
    ): Builder {
        return $query
            ->where('room_id', $roomId)
            ->blocking()
            ->when($excludeId, fn (Builder $builder) => $builder->where('id', '!=', $excludeId))
            ->where('start_time', '<', $endTime)
            ->where('end_time', '>', $startTime);
    }

    public function scopeActiveAt(Builder $query, CarbonInterface $moment): Builder
    {
        return $query
            ->blocking()
            ->where('start_time', '<=', $moment)
            ->where('end_time', '>', $moment);
    }

    public function scopeUpcomingFrom(Builder $query, CarbonInterface $moment): Builder
    {
        return $query
            ->blocking()
            ->where('start_time', '>=', $moment)
            ->orderBy('start_time');
    }

    public function scopeForToday(Builder $query, CarbonInterface $moment): Builder
    {
        return $query
            ->whereDate('start_time', $moment->toDateString())
            ->orderBy('start_time');
    }
}
