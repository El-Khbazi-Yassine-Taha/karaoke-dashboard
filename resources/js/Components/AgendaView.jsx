import React, { useMemo, useState } from 'react';
import { router } from '@inertiajs/react';
import { formatPhoneDisplay } from '../lib/formatPhone';
import { deskVisit } from '../lib/deskVisit';

const DAY_START_HOUR = 12;
const DAY_END_HOUR = 22;
const SLOT_WIDTH = 100;
const ROW_HEIGHT = 88;
const LABEL_WIDTH = 140;

function parseDatePart(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) return match[1];
        // Avoid toISOString() timezone shift (UTC can move the day back)
        const local = new Date(value);
        if (!Number.isNaN(local.getTime())) {
            const y = local.getFullYear();
            const m = String(local.getMonth() + 1).padStart(2, '0');
            const d = String(local.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return null;
    }
    try {
        const local = new Date(value);
        const y = local.getFullYear();
        const m = String(local.getMonth() + 1).padStart(2, '0');
        const d = String(local.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    } catch {
        return null;
    }
}

function toMinutesFromDayStart(value) {
    if (!value) return null;
    const raw = typeof value === 'string' ? value.replace(' ', 'T') : String(value);
    const match = raw.match(/T?(\d{2}):(\d{2})/);
    if (!match) return null;
    return (Number(match[1]) - DAY_START_HOUR) * 60 + Number(match[2]);
}

function formatHour(hour) {
    return `${String(hour).padStart(2, '0')}:00`;
}

function formatTimeLabel(value) {
    if (!value) return '--:--';
    const match = String(value).match(/T?(\d{2}:\d{2})/);
    return match ? match[1] : '--:--';
}

function formatDateHeading(dateStr) {
    try {
        return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });
    } catch {
        return dateStr;
    }
}

function isPaid(item) {
    const v = item.is_paid ?? item.paid ?? item.payment_status;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'paid';
    return false;
}

export default function AgendaView({ reservations = [], rooms = [] }) {
    const todayStr = (() => {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    })();
    const [selectedDate, setSelectedDate] = useState(todayStr);
    const [selectedId, setSelectedId] = useState(null);
    const [syncing, setSyncing] = useState(false);

    function toLocalDateStr(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    /** Refresh only — never auto-run on date change (that froze every click ~5s). */
    function pullWebReservations(date) {
        if (!date || syncing) return;
        setSyncing(true);
        router.post(
            '/agenda/sync',
            { date },
            {
                ...deskVisit(),
                onFinish: () => {
                    // Background sync finishes a moment later — reload Agenda rows
                    window.setTimeout(() => {
                        router.reload({
                            only: ['reservations'],
                            preserveScroll: true,
                            preserveState: true,
                            onFinish: () => setSyncing(false),
                        });
                    }, 2000);
                },
            }
        );
    }

    const totalHours = DAY_END_HOUR - DAY_START_HOUR;
    const timelineWidth = totalHours * SLOT_WIDTH;
    const slots = useMemo(
        () => Array.from({ length: totalHours }, (_, i) => DAY_START_HOUR + i),
        [totalHours]
    );

    const roomRows = useMemo(() => {
        if (rooms?.length) {
            return rooms
                .filter((room, index, self) => self.findIndex((r) => r.name === room.name) === index)
                .map((room) => ({
                    key: room.name,
                    name: room.name,
                    capacity: room.capacity || 8,
                }));
        }
        const names = [...new Set(reservations.map((r) => r.room_name).filter(Boolean))];
        return (names.length ? names : ['Room 1', 'Room 2']).map((name) => ({
            key: name,
            name,
            capacity: 8,
        }));
    }, [rooms, reservations]);

    const dayItems = useMemo(() => {
        return reservations
            .filter((res) => parseDatePart(res.date) === selectedDate)
            .map((res) => {
                const startMin = toMinutesFromDayStart(res.check_in);
                const endMin = toMinutesFromDayStart(res.check_out);
                if (startMin == null || endMin == null) return null;
                const clampedStart = Math.max(0, Math.min(totalHours * 60, startMin));
                const clampedEnd = Math.max(clampedStart + 15, Math.min(totalHours * 60, endMin));
                return {
                    ...res,
                    paid: isPaid(res),
                    startMin: clampedStart,
                    endMin: clampedEnd,
                    left: (clampedStart / 60) * SLOT_WIDTH,
                    width: Math.max(64, ((clampedEnd - clampedStart) / 60) * SLOT_WIDTH - 6),
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.startMin - b.startMin);
    }, [reservations, selectedDate, totalHours]);

    const selected = dayItems.find((item) => item.id === selectedId) || null;
    const now = new Date();
    const isToday = selectedDate === todayStr;
    const nowMinutes = isToday
        ? (now.getHours() - DAY_START_HOUR) * 60 + now.getMinutes()
        : null;
    const nowLeft =
        nowMinutes != null && nowMinutes >= 0 && nowMinutes <= totalHours * 60
            ? (nowMinutes / 60) * SLOT_WIDTH
            : null;

    const changeDate = (days) => {
        const date = new Date(`${selectedDate}T12:00:00`);
        date.setDate(date.getDate() + days);
        setSelectedDate(toLocalDateStr(date));
        setSelectedId(null);
    };

    return (
        <section className="overflow-hidden rounded-2xl border-2 border-black bg-white">
            <div className="flex flex-col gap-3 border-b-2 border-black px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                    <h2 className="text-[18px] font-black tracking-tight text-black">Agenda</h2>
                    <p className="text-[12px] font-semibold text-black/45">
                        {formatDateHeading(selectedDate)} · {dayItems.length} bookings
                        {isToday ? ' · auto-sync on' : ''}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => pullWebReservations(selectedDate)}
                        disabled={syncing}
                        className="h-9 rounded-lg border-2 border-black bg-white px-3 text-[12px] font-black text-black hover:bg-[#FFD400]/40 disabled:opacity-50"
                    >
                        {syncing ? 'Sync…' : 'Refresh'}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSelectedDate(todayStr);
                            setSelectedId(null);
                        }}
                        className={`h-9 rounded-lg border-2 border-black px-3.5 text-[12px] font-black transition ${
                            isToday
                                ? 'bg-[#FFD400] text-black'
                                : 'bg-white text-black hover:bg-[#FFD400]/40'
                        }`}
                    >
                        Today
                    </button>
                    <div className="flex h-9 items-center overflow-hidden rounded-lg border-2 border-black bg-white">
                        <button
                            type="button"
                            onClick={() => changeDate(-1)}
                            className="flex h-full w-9 items-center justify-center text-black/60 hover:bg-[#FFD400]/40 hover:text-black"
                        >
                            ‹
                        </button>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => {
                                setSelectedDate(e.target.value);
                                setSelectedId(null);
                            }}
                            className="h-full w-[8.25rem] border-x-2 border-black bg-transparent px-1 text-center text-[11px] font-bold text-black outline-none"
                        />
                        <button
                            type="button"
                            onClick={() => changeDate(1)}
                            className="flex h-full w-9 items-center justify-center text-black/60 hover:bg-[#FFD400]/40 hover:text-black"
                        >
                            ›
                        </button>
                    </div>
                </div>
            </div>

            {selected && (
                <div className="grid gap-3 border-b-2 border-black bg-[#F7F4EC] px-4 py-3.5 sm:grid-cols-5 sm:px-5">
                    <Detail label="Guest" value={selected.client_name || '—'} />
                    <Detail label="Phone" value={formatPhoneDisplay(selected.client_phone)} />
                    <Detail label="Email" value={selected.client_email || '—'} />
                    <Detail label="Party" value={`${Number(selected.members_count) || 1}`} />
                    <Detail
                        label="Slot"
                        value={`${formatTimeLabel(selected.check_in)}–${formatTimeLabel(selected.check_out)}`}
                    />
                </div>
            )}

            <div className="overflow-x-auto">
                <div className="min-w-max">
                    <div className="flex border-b-2 border-black">
                        <div
                            className="sticky left-0 z-20 flex shrink-0 items-end border-r-2 border-black bg-white px-3 pb-2"
                            style={{ width: LABEL_WIDTH }}
                        >
                            <span className="text-[10px] font-black uppercase tracking-[0.14em] text-black/40">
                                Room
                            </span>
                        </div>
                        <div className="flex" style={{ width: timelineWidth }}>
                            {slots.map((hour) => (
                                <div
                                    key={hour}
                                    className="flex h-11 items-end border-r border-black/10 px-2 pb-2"
                                    style={{ width: SLOT_WIDTH }}
                                >
                                    <span className="text-[12px] font-black tabular-nums text-black">
                                        {formatHour(hour)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {roomRows.map((room) => {
                        const roomItems = dayItems.filter((item) => item.room_name === room.name);
                        return (
                            <div key={room.key} className="flex border-b border-black/15 last:border-b-0">
                                <div
                                    className="sticky left-0 z-20 flex shrink-0 flex-col justify-center border-r-2 border-black bg-white px-3"
                                    style={{ width: LABEL_WIDTH, height: ROW_HEIGHT }}
                                >
                                    <p className="truncate text-[14px] font-black text-black">{room.name}</p>
                                    <p className="text-[11px] font-semibold text-black/40">
                                        {roomItems.length} booked
                                    </p>
                                </div>

                                <div className="relative bg-[#FAFAF7]" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
                                    {slots.map((hour, idx) => (
                                        <div
                                            key={`${room.key}-${hour}`}
                                            className="absolute top-0 bottom-0 border-r border-black/5"
                                            style={{ left: idx * SLOT_WIDTH, width: SLOT_WIDTH }}
                                        />
                                    ))}

                                    {nowLeft != null && (
                                        <div
                                            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-[#FFD400]"
                                            style={{ left: nowLeft }}
                                        >
                                            <div className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[#FFD400] ring-2 ring-black" />
                                        </div>
                                    )}

                                    {roomItems.map((item) => {
                                        const active = selectedId === item.id;
                                        return (
                                            <button
                                                key={item.id}
                                                type="button"
                                                onClick={() => setSelectedId(active ? null : item.id)}
                                                className={`absolute top-2.5 bottom-2.5 z-[5] overflow-hidden rounded-lg border-2 border-black px-2.5 py-1.5 text-left transition ${
                                                    active
                                                        ? 'bg-black text-[#FFD400]'
                                                        : 'bg-[#FFD400] text-black hover:brightness-95'
                                                }`}
                                                style={{ left: item.left + 3, width: item.width }}
                                                title={`${item.client_name} · ${item.source === 'agenda-waw' ? 'Web' : 'reserved'}`}
                                            >
                                                <p className="truncate text-[13px] font-black leading-tight">
                                                    {item.source === 'agenda-waw' ? `Web · ${item.client_name}` : item.client_name}
                                                </p>
                                                <p
                                                    className={`mt-0.5 truncate text-[11px] font-bold tabular-nums ${
                                                        active ? 'text-[#FFD400]/70' : 'text-black/55'
                                                    }`}
                                                >
                                                    {formatTimeLabel(item.check_in)}–
                                                    {formatTimeLabel(item.check_out)}
                                                </p>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {dayItems.length === 0 && (
                <div className="px-4 py-10 text-center">
                    <p className="text-[14px] font-black text-black">No reservations</p>
                    <p className="mt-1 text-[12px] font-semibold text-black/40">
                        {formatHour(DAY_START_HOUR)}–{formatHour(DAY_END_HOUR)}
                    </p>
                </div>
            )}

            <div className="flex flex-wrap gap-4 border-t-2 border-black px-4 py-2.5 text-[11px] font-bold text-black/50">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm border-2 border-black bg-[#FFD400]" /> Reserved
                </span>
                {isToday && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-3 w-0.5 bg-[#FFD400]" /> Now
                    </span>
                )}
            </div>
        </section>
    );
}

function Detail({ label, value }) {
    return (
        <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-black/40">{label}</p>
            <p className="mt-0.5 truncate text-[13px] font-bold text-black">{value}</p>
        </div>
    );
}
