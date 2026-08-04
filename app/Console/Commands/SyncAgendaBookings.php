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
        $count = $date
            ? $agenda->syncReservations($date)
            : $agenda->syncUpcomingDays(0, 7);
        $this->info("Synced {$count} reservation(s) from agenda-waw.");

        // Desk → web: lock hours so Complet shows when rooms are taken at the desk.
        $pushed = $agenda->pushDeskLocksToAgenda($date);
        if ($pushed > 0) {
            $this->info("Pushed {$pushed} desk lock(s) to agenda-waw.");
        }

        $released = $agenda->releaseOrphanDeskLocks($date);
        if ($released > 0) {
            $this->info("Released {$released} orphan desk lock(s) on agenda-waw.");
        }

        return self::SUCCESS;
    }
}
