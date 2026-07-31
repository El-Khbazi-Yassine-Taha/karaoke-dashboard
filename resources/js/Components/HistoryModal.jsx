import { useEffect, useState, useMemo } from 'react';

const PAYMENT_LABELS = {
    cash: 'Cash',
    debit_card: 'Debit card',
    carte: 'Carte',
    complimentary: 'Complimentary',
};

function formatDayLabel(dateStr) {
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

export default function HistoryModal({ open, onClose }) {
    const todayStr = new Date().toISOString().split('T')[0];
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(todayStr);
    const [data, setData] = useState({
        entered: [],
        cancelled: [],
        noShows: [],
        totals: {
            collected: 0,
            pending: 0,
            potential: 0,
            byMethod: { cash: 0, debit_card: 0, carte: 0 },
            complimentaryCount: 0,
            complimentaryValue: 0,
            noShowCount: 0,
        },
    });
    const [dailyDays, setDailyDays] = useState([]);
    const [tab, setTab] = useState('entered');

    useEffect(() => {
        if (!open) return;

        setLoading(true);
        const dayUrl = `/history/today?date=${encodeURIComponent(selectedDate)}`;

        Promise.all([
            fetch(dayUrl, {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            }).then((r) => r.json()),
            fetch('/history/daily?days=14', {
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            }).then((r) => r.json()),
        ])
            .then(([dayJson, dailyJson]) => {
                setData({
                    entered: dayJson.entered || [],
                    cancelled: dayJson.cancelled || [],
                    noShows: dayJson.noShows || [],
                    totals: dayJson.totals || {
                        collected: 0,
                        pending: 0,
                        potential: 0,
                        byMethod: { cash: 0, debit_card: 0, carte: 0 },
                        complimentaryCount: 0,
                        complimentaryValue: 0,
                        noShowCount: 0,
                    },
                });
                setDailyDays(dailyJson.days || []);
            })
            .catch(() => {
                setData({
                    entered: [],
                    cancelled: [],
                    noShows: [],
                    totals: {
                        collected: 0,
                        pending: 0,
                        potential: 0,
                        byMethod: { cash: 0, debit_card: 0, carte: 0 },
                        complimentaryCount: 0,
                        complimentaryValue: 0,
                        noShowCount: 0,
                    },
                });
                setDailyDays([]);
            })
            .finally(() => setLoading(false));
    }, [open, selectedDate]);

    const totals = data.totals || {};
    const byMethod = totals.byMethod || { cash: 0, debit_card: 0, carte: 0 };

    const list = useMemo(() => {
        if (tab === 'entered') return data.entered;
        if (tab === 'cancelled') return data.cancelled;
        if (tab === 'noshow') return data.noShows;
        return [];
    }, [tab, data]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border-2 border-black bg-[#FFFDF5] p-6 shadow-[4px_4px_0_#000]">
                <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8A7400]">
                            End of day
                        </p>
                        <h2 className="text-xl font-semibold tracking-tight text-[#111]">Session history</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg px-2 py-1 text-[#6B6B6B] transition hover:bg-[#F7F4EC] hover:text-[#111]"
                    >
                        ✕
                    </button>
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="rounded-lg border border-[#E8E4D9] bg-white px-3 py-2 text-sm font-semibold text-[#111] outline-none focus:border-[#C9A227]"
                    />
                    <button
                        type="button"
                        onClick={() => setSelectedDate(todayStr)}
                        className="rounded-lg border border-[#E8E4D9] bg-white px-3 py-2 text-xs font-semibold text-[#111] hover:bg-[#F7F4EC]"
                    >
                        Today
                    </button>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                    {[
                        { id: 'entered', label: `Entered (${data.entered.length})` },
                        { id: 'noshow', label: `No-show (${data.noShows.length})` },
                        { id: 'cancelled', label: `Cancelled (${data.cancelled.length})` },
                        { id: 'daily', label: 'Daily totals' },
                    ].map((t) => (
                        <button
                            key={t.id}
                            onClick={() => setTab(t.id)}
                            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                                tab === t.id
                                    ? 'bg-[#111] text-white'
                                    : 'border border-[#E8E4D9] bg-white text-[#111] hover:bg-[#F7F4EC]'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {tab !== 'daily' && !loading && (
                    <div className="mb-4 space-y-2">
                        <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#E8E4D9] bg-[#F7F4EC] p-3">
                            <div className="text-center">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                    Collected
                                </div>
                                <div className="text-base font-semibold text-[#111]">
                                    {totals.collected ?? 0} DHS
                                </div>
                            </div>
                            <div className="border-x border-[#E8E4D9] text-center">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                    Pending
                                </div>
                                <div className="text-base font-semibold text-[#B42318]">
                                    {totals.pending ?? 0} DHS
                                </div>
                            </div>
                            <div className="text-center">
                                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                    Total
                                </div>
                                <div className="text-base font-semibold text-[#111]">
                                    {totals.potential ?? 0} DHS
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#E8E4D9] bg-white p-3">
                            {['cash', 'debit_card', 'carte'].map((m) => (
                                <div key={m} className="text-center">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                        {PAYMENT_LABELS[m]}
                                    </div>
                                    <div className="text-sm font-semibold text-[#111]">
                                        {byMethod[m] ?? 0} DHS
                                    </div>
                                </div>
                            ))}
                        </div>

                        {(totals.complimentaryCount > 0 || totals.noShowCount > 0) && (
                            <p className="text-xs font-medium text-[#6B6B6B]">
                                {totals.complimentaryCount > 0 && (
                                    <span>
                                        {totals.complimentaryCount} complimentary (staff invite)
                                        {totals.complimentaryValue
                                            ? ` · ${totals.complimentaryValue} DHS waived`
                                            : ''}
                                    </span>
                                )}
                                {totals.complimentaryCount > 0 && totals.noShowCount > 0 && ' · '}
                                {totals.noShowCount > 0 && (
                                    <span>{totals.noShowCount} no-show (not counted as paid)</span>
                                )}
                            </p>
                        )}
                    </div>
                )}

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                    {loading && <p className="text-sm text-[#6B6B6B]">Loading…</p>}

                    {!loading && tab === 'daily' && (
                        <>
                            {dailyDays.length === 0 && (
                                <p className="text-sm text-[#6B6B6B]">No daily data yet.</p>
                            )}
                            {dailyDays.map((day) => (
                                <button
                                    key={day.date}
                                    type="button"
                                    onClick={() => {
                                        setSelectedDate(day.date);
                                        setTab('entered');
                                    }}
                                    className={`w-full rounded-xl border p-3 text-left transition hover:border-[#111] ${
                                        day.date === selectedDate
                                            ? 'border-[#111] bg-[#FFD400]/30'
                                            : 'border-[#E8E4D9] bg-white'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="font-semibold text-[#111]">
                                                {formatDayLabel(day.date)}
                                            </div>
                                            <div className="mt-0.5 text-xs text-[#6B6B6B]">
                                                {day.sessions} sessions
                                                {day.complimentary > 0
                                                    ? ` · ${day.complimentary} free`
                                                    : ''}
                                                {day.noShows > 0 ? ` · ${day.noShows} no-show` : ''}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-base font-semibold text-[#111]">
                                                {day.collected} DHS
                                            </div>
                                            <div className="text-[10px] font-medium text-[#6B6B6B]">
                                                C {day.byMethod?.cash ?? 0} · D{' '}
                                                {day.byMethod?.debit_card ?? 0} · Carte{' '}
                                                {day.byMethod?.carte ?? 0}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </>
                    )}

                    {!loading && tab !== 'daily' && list.length === 0 && (
                        <p className="text-sm text-[#6B6B6B]">Nothing here for this day.</p>
                    )}

                    {!loading &&
                        tab !== 'daily' &&
                        list.map((item) => {
                            const price = Number(item.totalPrice) || 0;
                            const methodLabel = item.isComplimentary
                                ? 'Complimentary'
                                : PAYMENT_LABELS[item.paymentMethod] ||
                                  item.paymentMethodLabel ||
                                  (item.paid ? 'Paid' : 'Unpaid');

                            return (
                                <div
                                    key={item.id}
                                    className={`rounded-xl border p-3 ${
                                        tab === 'cancelled' || tab === 'noshow'
                                            ? 'border-[#F5D0C8] bg-[#FFF5F3]'
                                            : 'border-[#E8E4D9] bg-white'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="font-semibold capitalize text-[#111]">
                                                {item.clientName}
                                            </div>
                                            <div className="text-xs text-[#6B6B6B]">{item.roomName}</div>
                                            {tab === 'entered' && (
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    <span
                                                        className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                                                            item.isComplimentary
                                                                ? 'bg-[#FFD400] text-black'
                                                                : item.paid
                                                                  ? 'bg-[#111] text-white'
                                                                  : 'border border-[#F5D0C8] bg-white text-[#B42318]'
                                                        }`}
                                                    >
                                                        {item.isComplimentary
                                                            ? `Free · invite by ${item.invitedBy || 'staff'}`
                                                            : `${price} DHS · ${methodLabel}`}
                                                    </span>
                                                </div>
                                            )}
                                            {tab === 'noshow' && (
                                                <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-[#B42318]">
                                                    No-show · not billed
                                                </div>
                                            )}
                                            {tab === 'cancelled' && (
                                                <div className="mt-1 space-y-0.5">
                                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#B42318]">
                                                        {item.cancelLabel ||
                                                            (item.cancelSource === 'web'
                                                                ? 'Cancelled on web'
                                                                : 'Cancelled by staff')}
                                                    </div>
                                                    <div className="text-[10px] font-medium text-[#6B6B6B]">
                                                        {item.bookedLabel ||
                                                            (item.bookedVia === 'web'
                                                                ? 'Booked online'
                                                                : 'Booked at desk')}
                                                        {item.cancelledAt ? ` · ${item.cancelledAt}` : ''}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right font-mono text-xs font-medium text-[#444]">
                                            {item.start} – {item.end}
                                            {tab === 'entered' && item.status === 'in_progress' && (
                                                <div className="mt-1 font-sans text-[#8A7400]">
                                                    Currently in room
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}
