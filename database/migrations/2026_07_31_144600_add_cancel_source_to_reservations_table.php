<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->string('cancel_source')->nullable()->after('status'); // web | staff
            $table->timestamp('cancelled_at')->nullable()->after('cancel_source');
        });
    }

    public function down(): void
    {
        Schema::table('reservations', function (Blueprint $table) {
            $table->dropColumn(['cancel_source', 'cancelled_at']);
        });
    }
};
