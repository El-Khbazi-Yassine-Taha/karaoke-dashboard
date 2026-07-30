<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('room_id')->constrained()->cascadeOnDelete();
            $table->string('client_name');
            $table->dateTime('start_time');
            $table->dateTime('end_time');
            $table->enum('status', [
                'pending',
                'confirmed',
                'in_progress',
                'completed',
                'cancelled',
            ])->default('confirmed');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index('room_id');
            $table->index('start_time');
            $table->index('end_time');
            $table->index(['room_id', 'start_time', 'end_time'], 'bookings_room_time_range_index');
            $table->index(['room_id', 'status'], 'bookings_room_status_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('bookings');
    }
};
