import { useMemo, useState, useEffect } from 'react';
import { router } from '@inertiajs/react';
import { deskVisit } from '../lib/deskVisit';

const DURATION_PRESETS = [
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
];

const CLOSING_LIMIT_MINS = 23 * 60;

function currentHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeToMins(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(':').map(Number);
    let mins = h * 60 + (m || 0);
    if (h < 6) mins += 1440;
    return mins;
}

function minsToTime(m) {
    const total = ((m % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60) % 24;
    const mins = total % 60;
    return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Busy blocks for a room: live session + upcoming queue. */
function collectBusyBlocks(room) {
    if (!room) return { raw: [], merged: [] };
    const blocks = [];

    if (room.state === 'occupied' && room.checkoutTime) {
        blocks.push({
            start: room.startTime || currentHHMM(),
            end: room.checkoutTime,
            name: room.currentClient || 'Live',
        });
    }

    for (const b of room.upcoming || []) {
        const status = (b.status || '').toLowerCase();
        if (status === 'in_progress') continue;
        if (!b.start || !b.end) continue;
        blocks.push({
            start: b.start,
            end: b.end,
            name: b.clientName || 'Guest',
        });
    }

    blocks.sort((a, b) => timeToMins(a.start) - timeToMins(b.start));

    const merged = [];
    for (const b of blocks) {
        const start = timeToMins(b.start);
        const end = timeToMins(b.end);
        if (!merged.length || start > merged[merged.length - 1].endMins) {
            merged.push({
                startMins: start,
                endMins: end,
                start: b.start,
                end: b.end,
                name: b.name,
            });
        } else {
            const last = merged[merged.length - 1];
            last.endMins = Math.max(last.endMins, end);
            last.end = minsToTime(last.endMins);
        }
    }

    return { raw: blocks, merged };
}

/**
 * Gaps that fit durationMinutes (between now and closing).
 * Also returns busyUntil = end of continuous stack from now.
 * Never throws — bad room data must not blank the dashboard.
 */
function findScheduleGaps(room, durationMinutes) {
    const empty = {
        gaps: [],
        nextSlot: null,
        busyUntil: null,
        isFreeNow: false,
    };

    try {
        const nowMins = timeToMins(currentHHMM());
        const blocks = collectBusyBlocks(room);
        const raw = Array.isArray(blocks?.raw) ? blocks.raw : [];
        const merged = Array.isArray(blocks?.merged) ? blocks.merged : [];
        const duration = Math.max(1, Number(durationMinutes) || 60);

        let cursor = nowMins;
        for (const b of raw) {
            const s = timeToMins(b.start);
            const e = timeToMins(b.end);
            if (s <= cursor && e > cursor) {
                cursor = e;
            }
        }

        const gaps = [];
        const sorted = [...raw].sort((a, b) => timeToMins(a.start) - timeToMins(b.start));

        for (const b of sorted) {
            const bStart = timeToMins(b.start);
            const bEnd = timeToMins(b.end);
            if (bEnd <= cursor) continue;

            if (bStart > cursor) {
                const gapLen = bStart - cursor;
                if (gapLen >= duration) {
                    gaps.push({
                        start: minsToTime(cursor),
                        end: minsToTime(bStart),
                        minutes: gapLen,
                        label:
                            cursor <= nowMins + 1
                                ? `Now → ${minsToTime(bStart)}`
                                : `${minsToTime(cursor)} → ${minsToTime(bStart)}`,
                        beforeGuest: b.name,
                    });
                }
            }
            cursor = Math.max(cursor, bEnd);
        }

        if (cursor < CLOSING_LIMIT_MINS && CLOSING_LIMIT_MINS - cursor >= duration) {
            gaps.push({
                start: minsToTime(cursor),
                end: minsToTime(CLOSING_LIMIT_MINS),
                minutes: CLOSING_LIMIT_MINS - cursor,
                label: `After stack · from ${minsToTime(cursor)}`,
                afterStack: true,
            });
        }

        const stackEndMins = merged.reduce((max, m) => Math.max(max, m.endMins || 0), nowMins);
        const busyUntil =
            stackEndMins > nowMins && (room?.state === 'occupied' || (room?.upcoming || []).length > 0)
                ? minsToTime(stackEndMins)
                : null;

        return {
            gaps,
            nextSlot: gaps[0]?.start || null,
            busyUntil,
            isFreeNow: room?.state === 'free' && gaps[0] && timeToMins(gaps[0].start) <= nowMins + 1,
        };
    } catch (err) {
        console.error('[findScheduleGaps]', err);
        return empty;
    }
}

export default function QuickBookingModal({ open, onClose, rooms, selectedRoomId }) {
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [roomId, setRoomId] = useState('');
    const [startNow, setStartNow] = useState(true);
    const [clockTime, setClockTime] = useState(currentHHMM());
    const [duration, setDuration] = useState(60);
    const [customDuration, setCustomDuration] = useState('');
    const [selectedGapStart, setSelectedGapStart] = useState(null);

    const [membersCount, setMembersCount] = useState(1);
    const [isComplimentary, setIsComplimentary] = useState(false);
    const [invitedBy, setInvitedBy] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState({});

    const selectedRoom = rooms.find((r) => String(r.id) === String(roomId));
    const effectiveDuration = customDuration ? parseInt(customDuration, 10) : duration;

    const schedule = useMemo(
        () => findScheduleGaps(selectedRoom, effectiveDuration),
        [selectedRoom, effectiveDuration]
    );

    // Sync room & defaults when modal opens
    useEffect(() => {
        if (!open) return;

        const targetRoomId = selectedRoomId || (rooms.length > 0 ? rooms[0].id : '');
        setRoomId(targetRoomId);

        const targetRoom = rooms.find((r) => String(r.id) === String(targetRoomId));
        const info = findScheduleGaps(targetRoom, effectiveDuration || 60);
        setStartNow(true);
        setSelectedGapStart(null);
        setClockTime(info.nextSlot || targetRoom?.checkoutTime || currentHHMM());

        setClientPhone('');
        setMembersCount(1);
        setIsComplimentary(false);
        setInvitedBy('');
        setServerErrors({});
    }, [open, selectedRoomId, rooms]);

    // Keep proposed clock in sync when duration / room changes on "stack"
    useEffect(() => {
        if (!open || !startNow || selectedGapStart) return;
        if (schedule.nextSlot) setClockTime(schedule.nextSlot);
    }, [open, startNow, selectedGapStart, schedule.nextSlot, effectiveDuration, roomId]);

    const parsedMembers = membersCount === '' ? 1 : membersCount;
    const listPrice = parsedMembers <= 4 ? 200 : 200 + (parsedMembers - 4) * 40;
    const totalPrice = isComplimentary ? 0 : listPrice;

    const minClockTime = useMemo(() => {
        if (selectedRoom && selectedRoom.state === 'occupied' && selectedRoom.checkoutTime) {
            return selectedRoom.checkoutTime;
        }
        return currentHHMM();
    }, [selectedRoom]);

    const proposedStartTime = startNow
        ? selectedGapStart || schedule.nextSlot || currentHHMM()
        : clockTime;

    const collisionState = useMemo(() => {
        if (!selectedRoom) return { status: 'ok' };

        const proposedStart = timeToMins(proposedStartTime);
        const proposedEnd = proposedStart + effectiveDuration;

        if (proposedEnd > CLOSING_LIMIT_MINS) {
            return {
                status: 'closing_violation',
                message: `The venue closes at 23:00. This session would end at ${minsToTime(proposedEnd)}, which is past closing time.`,
            };
        }

        if (selectedRoom.state === 'occupied' && selectedRoom.checkoutTime) {
            const checkoutMins = timeToMins(selectedRoom.checkoutTime);
            if (proposedStart < checkoutMins) {
                return {
                    status: 'busy_conflict',
                    message: `Room is live until ${selectedRoom.checkoutTime}. Earliest slot is ${schedule.nextSlot || selectedRoom.checkoutTime}.`,
                };
            }
        }

        for (const b of selectedRoom.upcoming || []) {
            const status = (b.status || '').toLowerCase();
            if (status === 'in_progress') continue;

            const upStart = timeToMins(b.start);
            const upEnd = timeToMins(b.end);

            if (proposedStart >= upStart && proposedStart < upEnd) {
                return {
                    status: 'busy_conflict',
                    message: `Overlaps ${b.clientName}'s reservation (${b.start}–${b.end}).`,
                };
            }

            if (upStart > proposedStart && proposedEnd > upStart) {
                const overlapMinutes = proposedEnd - upStart;
                if (overlapMinutes <= 10) {
                    return {
                        status: 'warning',
                        clientName: b.clientName,
                        start: b.start,
                        proposedEndStr: minsToTime(proposedEnd),
                        overlapMinutes,
                    };
                }
                return {
                    status: 'blocked',
                    clientName: b.clientName,
                    start: b.start,
                    overlapMinutes,
                };
            }
        }

        return { status: 'ok' };
    }, [selectedRoom, proposedStartTime, effectiveDuration, schedule.nextSlot]);

    if (!open) return null;

    function pickGap(gap) {
        setSelectedGapStart(gap.start);
        setStartNow(false);
        setClockTime(gap.start);
    }

    function submit(e) {
        e.preventDefault();

        if (collisionState.status === 'busy_conflict' || collisionState.status === 'closing_violation') {
            alert(`TIME BLOCKED:\n\n${collisionState.message}`);
            return;
        }

        if (collisionState.status === 'blocked') {
            alert(
                `ACTION BLOCKED:\n\nThis booking overflows into ${collisionState.clientName}'s reservation by ${collisionState.overlapMinutes} minutes. The maximum allowed delay buffer is 10 minutes!`
            );
            return;
        }

        if (collisionState.status === 'warning') {
            const confirmed = window.confirm(
                `10-MINUTE BUFFER:\n\nThis will delay ${collisionState.clientName}'s start by ${collisionState.overlapMinutes} minutes (to ${collisionState.proposedEndStr}). Continue?`
            );
            if (!confirmed) return;
        }

        setSubmitting(true);
        setServerErrors({});

        // If staff picked a gap (or stack next slot), send that clock time.
        // "start_now" only when we truly want the server gap-finder and no explicit slot.
        const usingExplicitSlot = !startNow || Boolean(selectedGapStart);
        const startClock = usingExplicitSlot
            ? clockTime
            : null;

        router.post(
            '/bookings',
            {
                client_name: clientName,
                client_phone: clientPhone.trim() || null,
                room_id: roomId,
                start_now: usingExplicitSlot ? 0 : 1,
                start_clock_time: usingExplicitSlot ? startClock : null,
                duration_minutes: effectiveDuration,
                members_count: parsedMembers,
                is_paid: 0,
                is_complimentary: isComplimentary ? 1 : 0,
                invited_by: isComplimentary ? invitedBy : null,
            },
            {
                ...deskVisit(),
                onSuccess: () => {
                    setClientName('');
                    setClientPhone('');
                    setCustomDuration('');
                    setMembersCount(1);
                    setIsComplimentary(false);
                    setInvitedBy('');
                    setSelectedGapStart(null);
                    onClose();
                },
                onError: (errors) => setServerErrors(errors),
                onFinish: () => setSubmitting(false),
            }
        );
    }

    const field =
        'w-full rounded-lg border border-[#E8E4D9] bg-white px-3 py-2 text-sm text-[#111] outline-none transition focus:border-[#C9A227] focus:ring-2 focus:ring-[#C9A227]/15';
    const pick = (on) =>
        on
            ? 'rounded-lg bg-[#111] px-3 py-2 text-sm font-semibold text-white'
            : 'rounded-lg border border-[#E8E4D9] bg-white px-3 py-2 text-sm font-semibold text-[#111] transition hover:bg-[#F7F4EC]';

    function roomSubtitle(room) {
        const info = findScheduleGaps(room, effectiveDuration || 60);
        if (room.state === 'free' && !info.busyUntil) {
            return info.nextSlot ? `Libre · prochain ${info.nextSlot}` : 'Libre';
        }
        if (info.busyUntil) {
            const gapHint =
                info.gaps.length > 1 || (info.gaps.length === 1 && !info.gaps[0].afterStack)
                    ? ` · gap ${info.gaps[0].start}`
                    : '';
            return `Occupé jusqu’à ${info.busyUntil}${gapHint}`;
        }
        return room.state === 'free' ? 'Libre' : `Occupé jusqu’à ${room.checkoutTime || '—'}`;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border-2 border-black bg-[#FFFDF5] shadow-[4px_4px_0_#000]">
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E8E4D9] px-6 pb-4 pt-6">
                    <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8A7400]">
                            Reservation
                        </p>
                        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#111]">New booking</h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded-lg px-2 py-1 text-[#6B6B6B] transition hover:bg-[#F7F4EC] hover:text-[#111]"
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={submit} className="space-y-4 overflow-y-auto px-6 py-5">
                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Client name
                        </label>
                        <input
                            type="text"
                            value={clientName}
                            onChange={(e) => setClientName(e.target.value)}
                            required
                            className={field}
                            placeholder="e.g. Guest Name"
                        />
                        {serverErrors.client_name && (
                            <p className="mt-1 text-sm text-red-600">{serverErrors.client_name}</p>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Phone number
                        </label>
                        <input
                            type="tel"
                            value={clientPhone}
                            onChange={(e) => setClientPhone(e.target.value)}
                            className={field}
                            placeholder="e.g. 06 12 34 56 78"
                            inputMode="tel"
                            autoComplete="tel"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Room
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {rooms.map((room) => (
                                <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => {
                                        setRoomId(room.id);
                                        setSelectedGapStart(null);
                                        setStartNow(true);
                                        const info = findScheduleGaps(room, effectiveDuration || 60);
                                        setClockTime(info.nextSlot || room.checkoutTime || currentHHMM());
                                    }}
                                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                                        String(roomId) === String(room.id)
                                            ? 'border-[#111] bg-[#111] text-white'
                                            : 'border-[#E8E4D9] bg-[#F7F4EC] text-[#111] hover:border-[#C9C2B0]'
                                    }`}
                                >
                                    <div className="font-semibold">{room.name}</div>
                                    <div
                                        className={`text-[11px] leading-snug ${
                                            String(roomId) === String(room.id)
                                                ? 'text-white/75'
                                                : 'text-[#6B6B6B]'
                                        }`}
                                    >
                                        {roomSubtitle(room)}
                                    </div>
                                </button>
                            ))}
                        </div>
                        {selectedRoom && schedule.busyUntil && (
                            <p className="mt-2 text-xs font-medium text-[#6B6B6B]">
                                Full stack busy until <span className="font-semibold text-[#111]">{schedule.busyUntil}</span>
                                {schedule.nextSlot ? (
                                    <>
                                        {' '}
                                        · next free slot{' '}
                                        <span className="font-semibold text-[#111]">{schedule.nextSlot}</span>
                                    </>
                                ) : null}
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Duration
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {DURATION_PRESETS.map((p) => (
                                <button
                                    key={p.minutes}
                                    type="button"
                                    onClick={() => {
                                        setDuration(p.minutes);
                                        setCustomDuration('');
                                    }}
                                    className={pick(duration === p.minutes && !customDuration)}
                                >
                                    {p.label}
                                </button>
                            ))}
                            <input
                                type="number"
                                max="480"
                                placeholder="Custom (min)"
                                value={customDuration}
                                onChange={(e) => setCustomDuration(e.target.value)}
                                className="w-28 rounded-lg border border-[#E8E4D9] bg-white px-3 py-2 text-sm text-[#111] outline-none focus:border-[#C9A227]"
                            />
                        </div>
                    </div>

                    {schedule.gaps.length > 0 && (
                        <div>
                            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                Free gaps ({effectiveDuration} min)
                            </label>
                            <div className="flex flex-col gap-2">
                                {schedule.gaps.map((gap) => {
                                    const selected =
                                        (startNow && !selectedGapStart && gap.start === schedule.nextSlot) ||
                                        selectedGapStart === gap.start ||
                                        (!startNow && clockTime === gap.start);
                                    return (
                                        <button
                                            key={`${gap.start}-${gap.end}`}
                                            type="button"
                                            onClick={() => {
                                                if (gap.afterStack && gap.start === schedule.nextSlot) {
                                                    setSelectedGapStart(null);
                                                    setStartNow(true);
                                                    setClockTime(gap.start);
                                                } else {
                                                    pickGap(gap);
                                                }
                                            }}
                                            className={`rounded-xl border px-3 py-2.5 text-left transition ${
                                                selected
                                                    ? 'border-[#111] bg-[#FFD400]/35'
                                                    : 'border-[#E8E4D9] bg-white hover:border-[#111]'
                                            }`}
                                        >
                                            <div className="text-sm font-semibold text-[#111]">{gap.label}</div>
                                            <div className="text-[11px] font-medium text-[#6B6B6B]">
                                                {gap.minutes} min free
                                                {gap.beforeGuest ? ` · before ${gap.beforeGuest}` : ''}
                                                {gap.afterStack ? ' · end of day stack' : ''}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Start time
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setStartNow(true);
                                    setSelectedGapStart(null);
                                    setClockTime(schedule.nextSlot || currentHHMM());
                                }}
                                className={pick(startNow && !selectedGapStart)}
                            >
                                Next free slot
                                {schedule.nextSlot ? ` (${schedule.nextSlot})` : ''}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStartNow(false);
                                    setSelectedGapStart(null);
                                    if (schedule.nextSlot) setClockTime(schedule.nextSlot);
                                }}
                                className={pick(!startNow && !selectedGapStart)}
                            >
                                Custom time
                            </button>
                            {!startNow && (
                                <input
                                    type="time"
                                    min={minClockTime}
                                    value={clockTime}
                                    onChange={(e) => {
                                        setClockTime(e.target.value);
                                        setSelectedGapStart(e.target.value);
                                    }}
                                    className={field + ' !w-auto'}
                                />
                            )}
                        </div>
                        {proposedStartTime && (
                            <p className="mt-2 text-xs font-medium text-[#6B6B6B]">
                                Will book{' '}
                                <span className="font-semibold text-[#111]">
                                    {proposedStartTime}–{minsToTime(timeToMins(proposedStartTime) + effectiveDuration)}
                                </span>
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Members & pricing
                        </label>
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={membersCount}
                                onChange={(e) =>
                                    setMembersCount(e.target.value === '' ? '' : parseInt(e.target.value, 10))
                                }
                                className={field}
                            />
                            <div className="whitespace-nowrap rounded-xl border border-[#E8E4D9] bg-[#F7F4EC] px-4 py-2 text-right">
                                <span className="block text-[10px] uppercase tracking-wide text-[#6B6B6B]">
                                    Total
                                </span>
                                <span className="text-sm font-semibold text-[#111]">
                                    {isComplimentary ? 'FREE' : `${totalPrice} DHS`}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#111]">
                            <input
                                type="checkbox"
                                checked={isComplimentary}
                                onChange={(e) => setIsComplimentary(e.target.checked)}
                                className="h-4 w-4 rounded border-black"
                            />
                            Invited by staff (free session)
                        </label>
                        {isComplimentary && (
                            <div>
                                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                                    Staff name who invited
                                </label>
                                <input
                                    type="text"
                                    value={invitedBy}
                                    onChange={(e) => setInvitedBy(e.target.value)}
                                    required={isComplimentary}
                                    className={field}
                                    placeholder="e.g. Name"
                                />
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        {collisionState.status === 'busy_conflict' && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium leading-relaxed text-[#B42318]">
                                Blocked: {collisionState.message}
                            </div>
                        )}
                        {collisionState.status === 'warning' && (
                            <div className="rounded-xl border border-[#E8E4D9] bg-[#FFFBEA] p-3 text-xs font-medium leading-relaxed text-[#6B4E00]">
                                Buffer notice: pushes into {collisionState.clientName} by{' '}
                                {collisionState.overlapMinutes} min.
                            </div>
                        )}
                        {collisionState.status === 'blocked' && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium leading-relaxed text-[#B42318]">
                                Blocked: overlaps {collisionState.clientName} by {collisionState.overlapMinutes}{' '}
                                min (over 10-min buffer).
                            </div>
                        )}
                        {collisionState.status === 'closing_violation' && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium leading-relaxed text-[#B42318]">
                                {collisionState.message}
                            </div>
                        )}
                        {serverErrors.start_clock_time && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium text-[#B42318]">
                                {serverErrors.start_clock_time}
                            </div>
                        )}
                        {serverErrors.room_id && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium text-[#B42318]">
                                {serverErrors.room_id}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 border-t border-[#E8E4D9] pt-3">
                        <button type="button" onClick={onClose} className="btn-waw-ghost">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={
                                submitting ||
                                collisionState.status === 'blocked' ||
                                collisionState.status === 'busy_conflict' ||
                                collisionState.status === 'closing_violation' ||
                                schedule.gaps.length === 0
                            }
                            className="btn-waw"
                        >
                            {submitting
                                ? 'Booking…'
                                : collisionState.status === 'warning'
                                  ? 'Force booking'
                                  : 'Confirm booking'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
