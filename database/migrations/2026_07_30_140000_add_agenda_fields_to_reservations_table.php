<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->uuid('agenda_booking_id')->nullable()->unique();
            $table->string('source')->nullable();
            $table->unsignedInteger('total_price')->nullable();
            $table->string('payment_status')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->dropColumn(['agenda_booking_id', 'source', 'total_price', 'payment_status']);
        });
    }
};
