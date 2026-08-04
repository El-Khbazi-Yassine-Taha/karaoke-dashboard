import React, { useMemo, useState } from 'react';
import { Head, Link } from '@inertiajs/react';

function statusLabel(displayStatus) {
    const s = String(displayStatus || '').toLowerCase();
    if (s === 'cancelled') return 'Cancelled';
    if (s === 'checked_in' || s === 'completed') return 'Checked in';
    if (s === 'no_show') return 'No-show';
    if (s === 'upcoming') return 'Upcoming';
    if (s === 'passed') return 'Passed';
    return displayStatus || '—';
}

function statusClass(displayStatus) {
    const s = String(displayStatus || '').toLowerCase();
    if (s === 'cancelled' || s === 'no_show') return 'bg-red-50 text-red-700';
    if (s === 'checked_in' || s === 'completed') return 'bg-emerald-50 text-emerald-800';
    if (s === 'passed') return 'bg-black/10 text-black/55';
    if (s === 'upcoming') return 'bg-[#FFD400]/35 text-black';
    return 'bg-black/5 text-black/70';
}

export default function WebInsights({
    visits = {},
    bookings = [],
    bookingsTotal = 0,
    bookingsPending = 0,
    bookingsPassed = 0,
    bookingsCancelled = 0,
    source = 'local',
}) {
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (bookings || []).filter((b) => {
            const display = String(b.displayStatus || b.status || '').toLowerCase();
            if (statusFilter !== 'all' && display !== statusFilter) return false;
            if (!q) return true;
            return [b.clientName, b.phone, b.email, b.date, b.timeSlot, b.end, b.roomName, b.whenLabel]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(q));
        });
    }, [bookings, query, statusFilter]);

    const visitDays = Array.isArray(visits.byDay) ? visits.byDay.slice(0, 14) : [];

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#FFD400]">
            <Head title="Web bookings & visits" />

            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-70 waw-bg-drift"
                style={{
                    backgroundImage: `url("/images/bacground-waw.svg")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />

            <div className="relative z-10 mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-black">Web bookings & visits</h1>
                        <p className="mt-1 text-sm font-semibold text-black/55">
                            Online reservations from agenda-waw
                            {source === 'live' ? ' · live feed' : ' · synced local copy'}
                        </p>
                    </div>
                    <Link href="/dashboard" className="btn-waw inline-flex self-start">
                        Back to dashboard
                    </Link>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        label="Visits today"
                        value={visits.available === false ? '—' : visits.today ?? 0}
                        hint={visits.available === false ? 'Agenda offline' : 'Unique sessions'}
                    />
                    <StatCard
                        label="Visits · 7 days"
                        value={visits.available === false ? '—' : visits.last7Days ?? 0}
                        hint="Site sessions"
                    />
                    <StatCard
                        label="Visits · all time"
                        value={visits.available === false ? '—' : visits.total ?? 0}
                        hint="Since tracking started"
                    />
                    <StatCard
                        label="Web bookings"
                        value={bookingsTotal}
                        hint={`${bookingsPending} upcoming · ${bookingsPassed} passed · ${bookingsCancelled} cancelled`}
                    />
                </div>

                {visitDays.length > 0 && (
                    <div className="mb-5 rounded-2xl border-2 border-black bg-[#FFFDF5] p-5">
                        <h2 className="mb-3 text-[12px] font-black uppercase tracking-[0.12em] text-black/45">
                            Visits by day
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            {visitDays.map((d) => (
                                <div
                                    key={d.date}
                                    className="rounded-xl border-2 border-black/10 bg-white px-3 py-2 text-center"
                                >
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-black/45">
                                        {d.date}
                                    </p>
                                    <p className="text-lg font-black tabular-nums text-black">{d.count}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="rounded-2xl border-2 border-black bg-[#FFFDF5] p-5 sm:p-6">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-black/45">
                                Booking history
                            </h2>
                            <p className="mt-1 text-sm font-semibold text-black/55">
                                {filtered.length} shown · web guests only
                            </p>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                type="search"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Search name, phone, email…"
                                className="w-full rounded-xl border-2 border-black bg-white px-3 py-2 text-sm font-semibold text-black outline-none placeholder:font-medium placeholder:text-black/35 focus:bg-[#FFD400]/20 sm:w-56"
                            />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="rounded-xl border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black outline-none"
                            >
                                <option value="all">All statuses</option>
                                <option value="upcoming">Upcoming</option>
                                <option value="passed">Passed</option>
                                <option value="checked_in">Checked in</option>
                                <option value="cancelled">Cancelled</option>
                                <option value="no_show">No-show</option>
                            </select>
                        </div>
                    </div>

                    {filtered.length === 0 ? (
                        <p className="rounded-xl border-2 border-dashed border-black/20 px-4 py-10 text-center text-sm font-semibold text-black/45">
                            No web bookings yet.
                        </p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-left text-sm">
                                <thead>
                                    <tr className="border-b-2 border-black/10 text-[11px] font-black uppercase tracking-wider text-black/40">
                                        <th className="pb-2 pr-3 font-black">Guest</th>
                                        <th className="pb-2 pr-3 font-black">When</th>
                                        <th className="pb-2 pr-3 font-black">Room</th>
                                        <th className="pb-2 pr-3 font-black">People</th>
                                        <th className="pb-2 pr-3 font-black">Price</th>
                                        <th className="pb-2 font-black">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((b) => {
                                        const display = b.displayStatus || b.status;
                                        const when =
                                            b.whenLabel ||
                                            `${b.date || '—'} · ${b.timeSlot || '—'}${b.end ? `–${b.end}` : ''}`;
                                        return (
                                            <tr key={String(b.id)} className="border-b border-black/5">
                                                <td className="py-3 pr-3 align-middle">
                                                    <p className="font-black text-black">{b.clientName}</p>
                                                    <p className="text-xs font-semibold text-black/45">
                                                        {[b.phone, b.email].filter(Boolean).join(' · ') || '—'}
                                                    </p>
                                                </td>
                                                <td className="py-3 pr-3 align-middle font-semibold tabular-nums text-black whitespace-nowrap">
                                                    {when}
                                                </td>
                                                <td className="py-3 pr-3 align-middle font-semibold text-black">
                                                    {b.roomName}
                                                </td>
                                                <td className="py-3 pr-3 align-middle font-semibold tabular-nums text-black">
                                                    {b.participants}
                                                </td>
                                                <td className="py-3 pr-3 align-middle font-black tabular-nums text-black">
                                                    {Number(b.totalPrice || 0)} DHS
                                                </td>
                                                <td className="py-3 align-middle">
                                                    <span
                                                        className={`inline-flex rounded-lg px-2 py-1 text-[11px] font-black ${statusClass(display)}`}
                                                    >
                                                        {statusLabel(display)}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, hint }) {
    return (
        <div className="rounded-2xl border-2 border-black bg-[#FFFDF5] px-4 py-4 shadow-[3px_3px_0_#000]">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-black/45">{label}</p>
            <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-black">{value}</p>
            {hint && <p className="mt-1 text-xs font-semibold text-black/45">{hint}</p>}
        </div>
    );
}
