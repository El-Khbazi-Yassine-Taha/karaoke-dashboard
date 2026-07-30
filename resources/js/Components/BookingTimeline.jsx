import { formatClockTime, formatTimelineRange } from '../hooks/useServerSyncedClock';

export default function BookingTimeline({ bookings }) {
    if (!bookings?.length) {
        return (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-sm font-semibold text-slate-300">Next bookings today</p>
                <p className="mt-3 text-sm text-slate-500">No upcoming reservations scheduled.</p>
            </div>
        );
    }

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <p className="text-sm font-semibold text-slate-300">Next bookings today</p>
            <ul className="mt-4 space-y-3">
                {bookings.map((booking) => (
                    <li
                        key={booking.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3"
                    >
                        <div>
                            <p className="font-medium text-slate-100">{booking.client_name}</p>
                            <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                                {booking.status.replace('_', ' ')}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm font-medium text-amber-300">
                                {formatTimelineRange(booking.start_time, booking.end_time)}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                                Ends {formatClockTime(booking.end_time)}
                            </p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
