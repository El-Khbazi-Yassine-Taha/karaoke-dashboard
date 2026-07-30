<?php

namespace Database\Seeders;

use App\Models\Room;
use Illuminate\Database\Seeder;

class RoomSeeder extends Seeder
{
    public function run(): void
    {
        $rooms = [
            ['name' => 'Room 1', 'capacity' => 8, 'status' => 'active'],
            ['name' => 'Room 2', 'capacity' => 10, 'status' => 'active'],
        ];

        foreach ($rooms as $room) {
            Room::query()->updateOrCreate(
                ['name' => $room['name']],
                $room
            );
        }
    }
}
