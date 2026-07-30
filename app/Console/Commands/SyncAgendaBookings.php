<?php

namespace App\Console\Commands;

use App\Services\AgendaClient;
use Illuminate\Console\Command;

class SyncAgendaBookings extends Command
{
    protected $signature = 'agenda:sync {--date= : Optional YYYY-MM-DD filter}';

    protected $description = 'Pull web reservations from agenda-waw into the local karaoke agenda';

    public function handle(AgendaClient $agenda): int
    {
        if (! $agenda->isConfigured()) {
            $this->error('AGENDA_API_URL is not configured.');

            return self::FAILURE;
        }

        $date = $this->option('date') ?: null;
        $count = $agenda->syncReservations($date);
        $this->info("Synced {$count} reservation(s) from agenda-waw.");

        return self::SUCCESS;
    }
}
