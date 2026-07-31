import { useMemo, useState, useEffect } from 'react';
import { router } from '@inertiajs/react';

const DURATION_PRESETS = [
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '1.5h', minutes: 90 },
    { label: '2h', minutes: 120 },
];

function currentHHMM() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeToMins(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    let mins = h * 60 + (m || 0);
    if (h < 6) mins += 1440; // Midnight crossover
    return mins;
}

function minsToTime(m) {
    const h = Math.floor(m / 60) % 24;
    const mins = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export default function QuickBookingModal({ open, onClose, rooms, selectedRoomId }) {
    const DISABLE_CLOSING_CHECK = true;

    const [clientName, setClientName] = useState('');
    const [roomId, setRoomId] = useState('');
    const [startNow, setStartNow] = useState(true);
    const [clockTime, setClockTime] = useState(currentHHMM());
    const [duration, setDuration] = useState(60);
    const [customDuration, setCustomDuration] = useState('');
    
    // Member count
    const [membersCount, setMembersCount] = useState(1);
    const [isComplimentary, setIsComplimentary] = useState(false);
    const [invitedBy, setInvitedBy] = useState('');

    const [submitting, setSubmitting] = useState(false);
    const [serverErrors, setServerErrors] = useState({});
    const [webSlotStatus, setWebSlotStatus] = useState(null); // { available, label } | null
    const [webSlotLoading, setWebSlotLoading] = useState(false);

    const selectedRoom = rooms.find((r) => String(r.id) === String(roomId));
    const effectiveDuration = customDuration ? parseInt(customDuration, 10) : duration;

    // Sync room & default time when modal opens
    useEffect(() => {
        if (open) {
            const targetRoomId = selectedRoomId || (rooms.length > 0 ? rooms[0].id : '');
            setRoomId(targetRoomId);

            const targetRoom = rooms.find((r) => String(r.id) === String(targetRoomId));
            if (targetRoom && targetRoom.checkoutTime) {
                setClockTime(targetRoom.checkoutTime);
            } else {
                setClockTime(currentHHMM());
            }

            setMembersCount(1);
            setIsComplimentary(false);
            setInvitedBy('');
            setServerErrors({});
            setWebSlotStatus(null);
        }
    }, [open, selectedRoomId, rooms]);

    // Check agenda-waw for Libre / Déjà réservé on the chosen hour
    useEffect(() => {
        if (!open) return;

        const date = new Date();
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        let time = startNow ? currentHHMM() : clockTime;
        if (startNow && selectedRoom?.state === 'occupied' && selectedRoom.checkoutTime) {
            time = selectedRoom.checkoutTime;
        }
        const hour = `${String(time).slice(0, 2)}:00`;

        let cancelled = false;
        setWebSlotLoading(true);
        fetch(`/agenda/availability?date=${encodeURIComponent(dateStr)}&time=${encodeURIComponent(hour)}`, {
            headers: { Accept: 'application/json' },
            credentials: 'same-origin',
        })
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                if (typeof data?.available === 'boolean') {
                    setWebSlotStatus({
                        available: data.available,
                        label: data.label || (data.available ? 'Libre' : 'Déjà réservé'),
                        time: hour,
                    });
                } else {
                    setWebSlotStatus(null);
                }
            })
            .catch(() => {
                if (!cancelled) setWebSlotStatus(null);
            })
            .finally(() => {
                if (!cancelled) setWebSlotLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [open, startNow, clockTime, selectedRoom, roomId]);

    // Calculate dynamic price safely handling empty states
    const parsedMembers = membersCount === '' ? 1 : membersCount;
    const listPrice = parsedMembers <= 4 ? 200 : 200 + (parsedMembers - 4) * 40;
    const totalPrice = isComplimentary ? 0 : listPrice;

    const minClockTime = useMemo(() => {
        if (selectedRoom && selectedRoom.state === 'occupied' && selectedRoom.checkoutTime) {
            return selectedRoom.checkoutTime;
        }
        return currentHHMM();
    }, [selectedRoom]);

    // Evaluate accurate gap, previous room overlaps & buffer delay
    const collisionState = useMemo(() => {
        if (!selectedRoom) return { status: 'ok' };

        let proposedStart = 0;
        if (startNow) {
            if (selectedRoom.state === 'occupied' && selectedRoom.checkoutTime) {
                proposedStart = timeToMins(selectedRoom.checkoutTime);
            } else {
                proposedStart = timeToMins(currentHHMM());
            }
        } else {
            proposedStart = timeToMins(clockTime);
        }

        const proposedEnd = proposedStart + effectiveDuration;

        // ── CLOSING TIME VALIDATION (23:00) ─────────────────────────────
        const CLOSING_LIMIT_MINS = 23 * 60; // 23:00
        if (proposedEnd > CLOSING_LIMIT_MINS) {
            return {
                status: 'closing_violation',
                message: `The venue closes at 23:00. This session would end at ${minsToTime(proposedEnd)}, which is past closing time.`,
            };
        }
        // ────────────────────────────────────────────────────────────────

        if (selectedRoom.state === 'occupied' && selectedRoom.checkoutTime && !startNow) {
            const checkoutMins = timeToMins(selectedRoom.checkoutTime);
            if (proposedStart < checkoutMins) {
                const earlyMins = checkoutMins - proposedStart;
                return {
                    status: 'busy_conflict',
                    message: `Room is busy until ${selectedRoom.checkoutTime}. You entered a start time that overlaps the current session by ${earlyMins} min!`,
                };
            }
        }

        if (selectedRoom.upcoming?.length) {
            for (const b of selectedRoom.upcoming) {
                if (b.status === 'IN_PROGRESS' || b.status === 'in_progress') continue;

                const upStart = timeToMins(b.start);
                const upEnd = timeToMins(b.end);

                if (proposedStart >= upStart && proposedStart < upEnd && !startNow) {
                    const earlyMins = upEnd - proposedStart;
                    return {
                        status: 'busy_conflict',
                        message: `Overlaps into ${b.clientName}'s reservation (${b.start}–${b.end}) by ${earlyMins} min!`,
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
                    } else {
                        return {
                            status: 'blocked',
                            clientName: b.clientName,
                            start: b.start,
                            overlapMinutes,
                        };
                    }
                }
            }
        }

        return { status: 'ok' };
    }, [selectedRoom, startNow, clockTime, effectiveDuration, DISABLE_CLOSING_CHECK]);

    if (!open) return null;

    function submit(e) {
        e.preventDefault();

        if (webSlotStatus && webSlotStatus.available === false) {
            alert('❌ Déjà réservé (web)\n\nCe créneau est pris sur agenda-waw. Choisissez un autre horaire.');
            return;
        }

        if (collisionState.status === 'busy_conflict' || collisionState.status === 'closing_violation') {
            alert(`❌ TIME BLOCKED:\n\n${collisionState.message}`);
            return;
        }

        if (collisionState.status === 'blocked') {
            alert(
                `❌ ACTION BLOCKED:\n\nThis booking overflows into ${collisionState.clientName}'s reservation by ${collisionState.overlapMinutes} minutes. The maximum allowed delay buffer is 10 minutes!`
            );
            return;
        }

        if (collisionState.status === 'warning') {
            const confirmed = window.confirm(
                `⚠️ 10-MINUTE BUFFER OVERRIDE:\n\nThis will delay ${collisionState.clientName}'s start time by ${collisionState.overlapMinutes} minutes (pushing them to ${collisionState.proposedEndStr}). Their full duration will be safely preserved.\n\nProceed with this adjustment?`
            );
            if (!confirmed) return;
        }

        setSubmitting(true);
        setServerErrors({});

        router.post(
            '/bookings',
            {
                client_name: clientName,
                room_id: roomId,
                start_now: startNow,
                start_clock_time: startNow ? null : clockTime,
                duration_minutes: effectiveDuration,
                members_count: parsedMembers,
                is_paid: 0,
                is_complimentary: isComplimentary ? 1 : 0,
                invited_by: isComplimentary ? invitedBy : null,
            },
            {
                preserveScroll: true,
                onSuccess: () => {
                    setClientName('');
                    setCustomDuration('');
                    setMembersCount(1);
                    setIsComplimentary(false);
                    setInvitedBy('');
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
                            Room
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {rooms.map((room) => (
                                <button
                                    key={room.id}
                                    type="button"
                                    onClick={() => {
                                        setRoomId(room.id);
                                        if (room.checkoutTime) setClockTime(room.checkoutTime);
                                    }}
                                    className={`rounded-xl border px-3 py-2.5 text-left transition ${
                                        String(roomId) === String(room.id)
                                            ? 'border-[#111] bg-[#111] text-white'
                                            : 'border-[#E8E4D9] bg-[#F7F4EC] text-[#111] hover:border-[#C9C2B0]'
                                    }`}
                                >
                                    <div className="font-semibold">{room.name}</div>
                                    <div className={`text-xs ${String(roomId) === String(room.id) ? 'text-white/70' : 'text-[#6B6B6B]'}`}>
                                        {room.state === 'free' ? 'Libre' : `Occupé jusqu’à ${room.checkoutTime}`}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="rounded-lg border border-[#E8E4D9] bg-[#F7F4EC] px-3 py-2 text-sm">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Agenda web · créneau horaire
                        </p>
                        {webSlotLoading ? (
                            <p className="mt-1 text-[#6B6B6B]">Vérification…</p>
                        ) : webSlotStatus ? (
                            <p
                                className={`mt-1 font-semibold ${
                                    webSlotStatus.available ? 'text-emerald-700' : 'text-red-700'
                                }`}
                            >
                                {webSlotStatus.time} — {webSlotStatus.label}
                                {!webSlotStatus.available ? ' (web)' : ''}
                            </p>
                        ) : (
                            <p className="mt-1 text-[#6B6B6B]">Disponibilité web indisponible</p>
                        )}
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#6B6B6B]">
                            Start time
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setStartNow(true)} className={pick(startNow)}>
                                Right now / stack
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStartNow(false);
                                    if (selectedRoom && selectedRoom.checkoutTime) {
                                        setClockTime(selectedRoom.checkoutTime);
                                    }
                                }}
                                className={pick(!startNow)}
                            >
                                Schedule later
                            </button>
                            {!startNow && (
                                <input
                                    type="time"
                                    min={minClockTime}
                                    value={clockTime}
                                    onChange={(e) => setClockTime(e.target.value)}
                                    className={field + ' !w-auto'}
                                />
                            )}
                        </div>
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
                        <p className="mt-1 text-[10px] text-[#6B6B6B]">
                            {isComplimentary
                                ? 'Staff invite — complimentary session'
                                : parsedMembers <= 4
                                  ? 'Standard rate (up to 4 members)'
                                  : `200 DHS + ${(parsedMembers - 4) * 40} DHS for extra members`}
                        </p>
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
                                {serverErrors.invited_by && (
                                    <p className="mt-1 text-sm text-red-600">{serverErrors.invited_by}</p>
                                )}
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
                                Buffer notice: this pushes into {collisionState.clientName}&apos;s reservation by{' '}
                                {collisionState.overlapMinutes} min (within the 10-min limit). Their start will
                                shift to keep full duration.
                            </div>
                        )}

                        {collisionState.status === 'blocked' && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium leading-relaxed text-[#B42318]">
                                Blocked: overlaps with {collisionState.clientName} by {collisionState.overlapMinutes}{' '}
                                min. Exceeds the 10-minute buffer.
                            </div>
                        )}

                        {collisionState.status === 'closing_violation' && (
                            <div className="rounded-xl border border-[#F5D0C8] bg-[#FFF5F3] p-3 text-xs font-medium leading-relaxed text-[#B42318]">
                                {collisionState.message}
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
                                collisionState.status === 'closing_violation'
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