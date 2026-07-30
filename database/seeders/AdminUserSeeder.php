<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    public function run(): void
    {
        $username = env('ADMIN_USERNAME', 'admin');
        $password = env('ADMIN_PASSWORD', 'admin123');

        User::updateOrCreate(
            ['username' => $username],
            [
                'name' => $username,
                'email' => null,
                'password' => $password,
                'role' => 'admin',
            ]
        );
    }
}
