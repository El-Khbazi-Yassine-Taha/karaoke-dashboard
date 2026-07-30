<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('reservations', function (Blueprint $table) {
            $table->id();
            $table->string('room_name');
            $table->string('client_name');
            $table->string('client_phone')->nullable();
            $table->string('client_email')->nullable();
            $table->dateTime('check_in');
            $table->dateTime('check_out');
            $table->date('date');
            $table->string('status')->default('confirmed');
            $table->string('calendly_uuid')->nullable()->unique();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reservations');
    }
};