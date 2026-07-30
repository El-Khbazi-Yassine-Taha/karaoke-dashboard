<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bookings', function (Blueprint $table) {
            $table->string('payment_method')->nullable()->after('paid');
            $table->boolean('is_complimentary')->default(false)->after('payment_method');
            $table->string('invited_by')->nullable()->after('is_complimentary');
        });

        // PostgreSQL enum: add no_show to bookings_status_check / status enum
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::statement("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check");
            DB::statement("ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status::text = ANY (ARRAY['pending'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text]))");
        } elseif ($driver === 'mysql') {
            DB::statement("ALTER TABLE bookings MODIFY COLUMN status ENUM('pending','confirmed','in_progress','completed','cancelled','no_show') NOT NULL DEFAULT 'confirmed'");
        }
    }

    public function down(): void
    {
        $driver = Schema::getConnection()->getDriverName();

        if ($driver === 'pgsql') {
            DB::table('bookings')->where('status', 'no_show')->update(['status' => 'cancelled']);
            DB::statement("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check");
            DB::statement("ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status::text = ANY (ARRAY['pending'::text, 'confirmed'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text]))");
        } elseif ($driver === 'mysql') {
            DB::table('bookings')->where('status', 'no_show')->update(['status' => 'cancelled']);
            DB::statement("ALTER TABLE bookings MODIFY COLUMN status ENUM('pending','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'confirmed'");
        }

        Schema::table('bookings', function (Blueprint $table) {
            $table->dropColumn(['payment_method', 'is_complimentary', 'invited_by']);
        });
    }
};
