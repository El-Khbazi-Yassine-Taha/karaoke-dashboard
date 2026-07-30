import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { router } from '@inertiajs/react';
import SessionRingTimer from './SessionRingTimer';

let sharedAudioCtx = null;

function getAudioContext() {
    if (!sharedAudioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
}

if (typeof window !== 'undefined') {
    const unlockAudio = () => {
        const ctx = getAudioContext();
        if (ctx) ctx.resume();
        window.removeEventListener('click', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
}

if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
    const requestNotifPermission = () => {
        Notification.requestPermission();
        window.removeEventListener('click', requestNotifPermission);
        window.removeEventListener('keydown', requestNotifPermission);
    };
    window.addEventListener('click', requestNotifPermission);
    window.addEventListener('keydown', requestNotifPermission);
}

function playEmergencyAlarm() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'square';

        const now = ctx.currentTime;
        osc1.frequency.setValueAtTime(600, now);
        osc1.frequency.exponentialRampToValueAtTime(1200, now + 0.4);
        osc2.frequency.setValueAtTime(300, now);
        osc2.frequency.exponentialRampToValueAtTime(800, now + 0.4);
        gainNode.gain.setValueAtTime(0.8, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.6);
        osc2.stop(now + 0.6);
    } catch (e) {}
}

function showBrowserNotification(roomName, clientName) {
    try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const notif = new Notification(`${roomName} — Time's up`, {
            body: `${clientName}'s session has ended. Please check them out.`,
            requireInteraction: true,
            tag: `room-alert-${roomName}`,
        });
        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    } catch (e) {}
}

function calculatePrice(members) {
    const count = Number(members) || 1;
    return 200 + Math.max(0, count - 4) * 40;
}

const PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash' },
    { id: 'debit_card', label: 'Debit card' },
    { id: 'carte', label: 'Carte' },
];

function paymentLabel(method, isComplimentary) {
    if (isComplimentary) return 'Complimentary';
    const found = PAYMENT_METHODS.find((m) => m.id === method);
    return found?.label || null;
}

function toBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val === 1;
    if (typeof val === 'string') return val === '1' || val.toLowerCase() === 'true';
    return false;
}

/** Desk actions (check-in, paid, delay, etc.) only apply to local bookings rows. */
function isDeskBooking(item) {
    if (!item?.id) return false;
    if (item.source === 'agenda-waw' || item.source === 'reservation') return false;
    return /^\d+$/.test(String(item.id));
}

const inputClass =
    'w-full rounded-xl border-2 border-black/15 bg-white px-3 py-2.5 text-sm text-black outline-none transition focus:border-black';

function MetaIcon({ children }) {
    return (
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-black/40">
            {children}
        </span>
    );
}

function OverflowMenu({ open, onToggle, items }) {
    const buttonRef = useRef(null);
    const [menuStyle, setMenuStyle] = useState(null);

    useLayoutEffect(() => {
        if (!open || !buttonRef.current) {
            setMenuStyle(null);
            return;
        }

        const updatePosition = () => {
            const buttonRect = buttonRef.current.getBoundingClientRect();
            const estimatedHeight = items.length * 36 + 8;
            const spaceBelow = window.innerHeight - buttonRect.bottom;
            const openUpward =
                spaceBelow < estimatedHeight + 8 && buttonRect.top > estimatedHeight + 8;

            setMenuStyle({
                position: 'fixed',
                right: window.innerWidth - buttonRect.right,
                ...(openUpward
                    ? { bottom: window.innerHeight - buttonRect.top + 4 }
                    : { top: buttonRect.bottom + 4 }),
                zIndex: 70,
            });
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open, items.length]);

    return (
        <div className="relative shrink-0">
            <button
                ref={buttonRef}
                type="button"
                onClick={onToggle}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-black/15 bg-white text-lg font-bold text-black transition hover:border-black hover:bg-[#FFD400]"
                aria-label="More actions"
            >
                ⋯
            </button>
            {open && (
                <>
                    <button
                        type="button"
                        className="fixed inset-0 z-[60] cursor-default"
                        aria-label="Close menu"
                        onClick={onToggle}
                    />
                    <div
                        style={menuStyle ?? { visibility: 'hidden', position: 'fixed' }}
                        className="min-w-[10.5rem] overflow-hidden rounded-xl border-2 border-black bg-[#FFFDF5] py-1 shadow-lg"
                    >
                        {items.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                disabled={item.disabled}
                                onClick={() => {
                                    item.onClick?.();
                                    onToggle();
                                }}
                                className={`block w-full px-3 py-2 text-left text-[13px] font-bold transition hover:bg-[#FFD400]/50 disabled:opacity-35 ${
                                    item.danger ? 'text-red-600' : 'text-black'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default function RoomColumn({ room, onOpenBooking }) {
    const isOccupied = room.state === 'occupied';

    const serverPaid = toBool(room.currentClientPaid ?? room.is_paid ?? room.paid);
    const [localPaid, setLocalPaid] = useState(serverPaid);
    const isClientPaid = localPaid;

    useEffect(() => {
        setLocalPaid(serverPaid);
    }, [serverPaid, room.bookingId]);

    const [isEditingActive, setIsEditingActive] = useState(false);
    const [editName, setEditName] = useState('');
    const [editStartTime, setEditStartTime] = useState('');
    const [editDuration, setEditDuration] = useState(60);

    const [editingBooking, setEditingBooking] = useState(null);
    const [editBookingName, setEditBookingName] = useState('');
    const [editBookingStartTime, setEditBookingStartTime] = useState('');
    const [editBookingDuration, setEditBookingDuration] = useState(60);

    const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
    const [unpaidConfirmStep, setUnpaidConfirmStep] = useState(false);
    const [paymentMethodPick, setPaymentMethodPick] = useState(null);
    const [payTargetId, setPayTargetId] = useState(null);
    const confirmedBookingsRef = useRef(new Set());
    const [openMenu, setOpenMenu] = useState(null);

    const isComplimentary = toBool(room.isComplimentary);
    const paymentMethod = room.paymentMethod || null;

    const isInitialMount = useRef(true);
    const lastBookingIdRef = useRef(null);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            lastBookingIdRef.current = room.bookingId ?? null;
            return;
        }

        if (typeof window !== 'undefined' && window.__freshBookingRoomIds?.has(String(room.id))) {
            confirmedBookingsRef.current.add(room.bookingId);
            window.__freshBookingRoomIds.delete(String(room.id));
            lastBookingIdRef.current = room.bookingId ?? null;
            return;
        }

        const bookingIdChanged = room.bookingId && room.bookingId !== lastBookingIdRef.current;
        const shouldShow =
            isOccupied && room.bookingId && bookingIdChanged && !confirmedBookingsRef.current.has(room.bookingId);

        if (shouldShow) {
            setPaymentConfirmOpen(true);
            setUnpaidConfirmStep(false);
        }

        if (!isOccupied) {
            setPaymentConfirmOpen(false);
            setUnpaidConfirmStep(false);
        }

        lastBookingIdRef.current = room.bookingId ?? null;
    }, [isOccupied, room.bookingId, room.id]);

    function confirmPayment(paid, method = null) {
        if (!room.bookingId) return;
        confirmedBookingsRef.current.add(room.bookingId);
        setLocalPaid(paid);
        setPaymentConfirmOpen(false);
        setUnpaidConfirmStep(false);
        setPaymentMethodPick(null);
        const payload = { paid: paid ? 1 : 0 };
        if (paid && method) payload.payment_method = method;
        router.post(`/bookings/${room.bookingId}/toggle-paid`, payload, { preserveScroll: true });
    }

    function openMarkPaid(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        setPayTargetId(bookingId);
        setPaymentMethodPick(null);
    }

    function submitMarkPaid(method) {
        const id = payTargetId || room.bookingId;
        if (!id || !method || !/^\d+$/.test(String(id))) return;
        const isCurrent = String(id) === String(room.bookingId);
        if (isCurrent) setLocalPaid(true);
        setPayTargetId(null);
        setPaymentMethodPick(null);
        router.post(
            `/bookings/${id}/toggle-paid`,
            { paid: 1, payment_method: method },
            { preserveScroll: true }
        );
    }

    function markUnpaid(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        const isCurrent = String(bookingId) === String(room.bookingId);
        if (isCurrent) setLocalPaid(false);
        router.post(`/bookings/${bookingId}/toggle-paid`, { paid: 0 }, { preserveScroll: true });
    }

    function checkIn(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        router.post(`/bookings/${bookingId}/check-in`, {}, { preserveScroll: true });
    }

    function markNoShow(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        if (!confirm('Mark as no-show? Guest did not arrive — will not count as paid.')) return;
        router.post(`/bookings/${bookingId}/no-show`, {}, { preserveScroll: true });
    }

    const [msRemaining, setMsRemaining] = useState(() => {
        if (!isOccupied || !room.checkoutTimeIso) return 0;
        return Math.max(0, new Date(room.checkoutTimeIso).getTime() - Date.now());
    });

    const [msFreeRemaining, setMsFreeRemaining] = useState(() => {
        if (isOccupied || !room.nextStart) return 0;
        const nextStartTime = new Date(`${new Date().toISOString().split('T')[0]}T${room.nextStart}`);
        return Math.max(0, nextStartTime.getTime() - Date.now());
    });

    const lastAlarmPlayedSec = useRef(null);

    useEffect(() => {
        if (!isOccupied || !room.checkoutTimeIso) {
            setMsRemaining(0);
            return;
        }
        const targetTime = new Date(room.checkoutTimeIso).getTime();
        const updateTimer = () => setMsRemaining(Math.max(0, targetTime - Date.now()));
        updateTimer();
        const interval = setInterval(updateTimer, 1000);
        return () => clearInterval(interval);
    }, [isOccupied, room.checkoutTimeIso]);

    useEffect(() => {
        if (isOccupied || !room.nextStart) {
            setMsFreeRemaining(0);
            return;
        }
        const nextStartTime = new Date(`${new Date().toISOString().split('T')[0]}T${room.nextStart}`);
        const updateFreeTimer = () => setMsFreeRemaining(Math.max(0, nextStartTime.getTime() - Date.now()));
        updateFreeTimer();
        const interval = setInterval(updateFreeTimer, 1000);
        return () => clearInterval(interval);
    }, [isOccupied, room.nextStart]);

    const secondsLeft = Math.floor(msRemaining / 1000);
    const showUrgentAlert = isOccupied && secondsLeft <= 60 && !paymentConfirmOpen;

    useEffect(() => {
        if (showUrgentAlert && secondsLeft > 0 && lastAlarmPlayedSec.current !== secondsLeft) {
            lastAlarmPlayedSec.current = secondsLeft;
            playEmergencyAlarm();
        }
    }, [secondsLeft, showUrgentAlert]);

    const wasUrgentRef = useRef(false);

    useEffect(() => {
        if (showUrgentAlert) {
            if (!wasUrgentRef.current) {
                showBrowserNotification(room.name, room.currentClient);
            }
            wasUrgentRef.current = true;
        } else {
            wasUrgentRef.current = false;
        }
    }, [showUrgentAlert, secondsLeft, room.name, room.currentClient]);

    const autoCheckoutFiredForBooking = useRef(null);

    useEffect(() => {
        if (!isOccupied || !room.bookingId || secondsLeft > 0) return;
        if (autoCheckoutFiredForBooking.current === room.bookingId) return;
        autoCheckoutFiredForBooking.current = room.bookingId;
        const timeoutId = setTimeout(() => {
            router.post(`/bookings/${room.bookingId}/checkout`, {}, { preserveScroll: true });
        }, 5000);
        return () => clearTimeout(timeoutId);
    }, [isOccupied, room.bookingId, secondsLeft]);

    function checkoutNow() {
        if (!room.bookingId) return;
        router.post(`/bookings/${room.bookingId}/checkout`, {}, { preserveScroll: true });
    }

    function togglePaid(bookingId, nextPaid = null) {
        const isCurrent = String(bookingId) === String(room.bookingId);
        const value = nextPaid === null ? (isCurrent ? !isClientPaid : true) : nextPaid;
        if (value) {
            openMarkPaid(bookingId);
            return;
        }
        markUnpaid(bookingId);
    }

    function cancelBooking(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        if (confirm('Cancel this reservation?')) {
            router.post(`/bookings/${bookingId}/cancel`, {}, { preserveScroll: true });
        }
    }

    function pushBooking(bookingId, minutes) {
        if (!/^\d+$/.test(String(bookingId))) return;
        router.post(`/bookings/${bookingId}/delay`, { minutes }, { preserveScroll: true });
    }

    function openEditModal() {
        setEditName(room.currentClient || '');
        setEditStartTime(room.startTime ? room.startTime.substring(0, 5) : '18:10');
        setEditDuration(60);
        setIsEditingActive(true);
    }

    function openEditBookingModal(booking) {
        setEditingBooking(booking);
        setEditBookingName(booking.clientName || '');
        setEditBookingStartTime(
            booking.start
                ? booking.start.substring(0, 5)
                : (booking.originalStart || booking.original_start || '18:10').substring(0, 5)
        );
        setEditBookingDuration(60);
    }

    function submitEditActive(e) {
        e.preventDefault();
        if (!room.bookingId) return;
        router.post(
            `/bookings/${room.bookingId}/update`,
            {
                client_name: editName,
                start_clock_time: editStartTime,
                duration_minutes: editDuration,
            },
            { preserveScroll: true, onSuccess: () => setIsEditingActive(false) }
        );
    }

    function submitEditBooking(e) {
        e.preventDefault();
        if (!editingBooking?.id || !isDeskBooking(editingBooking)) return;
        router.post(
            `/bookings/${editingBooking.id}/update`,
            {
                client_name: editBookingName,
                start_clock_time: editBookingStartTime,
                duration_minutes: editBookingDuration,
            },
            { preserveScroll: true, onSuccess: () => setEditingBooking(null) }
        );
    }

    const totalDurationMs =
        isOccupied && room.startTimeIso && room.checkoutTimeIso
            ? new Date(room.checkoutTimeIso).getTime() - new Date(room.startTimeIso).getTime()
            : 0;
    const elapsedMs = totalDurationMs ? totalDurationMs - msRemaining : 0;
    const progressPercent = totalDurationMs
        ? Math.min(100, Math.max(0, (elapsedMs / totalDurationMs) * 100))
        : 0;

    const mins = Math.floor(msRemaining / 60000);
    const secs = Math.floor((msRemaining % 60000) / 1000);
    const countdownFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const freeMins = Math.floor(msFreeRemaining / 60000);
    const freeSecs = Math.floor((msFreeRemaining % 60000) / 1000);
    const freeDurationFormatted = `${freeMins}m ${freeSecs}s`;

    const upcomingQueue = room.upcoming
        ? room.upcoming.filter((b) => {
              const isCurrentActive = room.bookingId && String(b.id) === String(room.bookingId);
              const status = (b.status || '').toLowerCase();
              return !isCurrentActive && status !== 'in_progress' && status !== 'completed' && status !== 'cancelled';
          })
        : [];

    const currentMembers = room.members || 1;
    const currentPrice = isComplimentary ? 0 : calculatePrice(currentMembers);
    const methodLabel = paymentLabel(paymentMethod, isComplimentary);
    const awaiting = room.awaitingCheckIn || null;

    return (
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border-2 border-black bg-white">
            {paymentConfirmOpen && !isComplimentary && (
                <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">Payment</p>
                    <h4 className="mb-4 text-xl font-black text-black">{room.name}</h4>
                    <p className="mb-1 text-lg font-bold capitalize text-black">{room.currentClient}</p>
                    <p className="mb-5 text-sm font-semibold text-black/55">
                        {currentMembers} guests · {currentPrice} DHS
                    </p>
                    {!unpaidConfirmStep ? (
                        paymentMethodPick ? (
                            <div className="w-full max-w-xs space-y-2">
                                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-black/45">
                                    Payment method
                                </p>
                                {PAYMENT_METHODS.map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => confirmPayment(true, m.id)}
                                        className="btn-waw w-full"
                                    >
                                        {m.label}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    onClick={() => setPaymentMethodPick(false)}
                                    className="btn-waw-ghost w-full"
                                >
                                    Back
                                </button>
                            </div>
                        ) : (
                            <div className="flex w-full max-w-xs gap-2">
                                <button onClick={() => setPaymentMethodPick(true)} className="btn-waw flex-1">
                                    Paid
                                </button>
                                <button onClick={() => setUnpaidConfirmStep(true)} className="btn-waw-ghost flex-1">
                                    Unpaid
                                </button>
                            </div>
                        )
                    ) : (
                        <div className="flex w-full max-w-xs gap-2">
                            <button onClick={() => setUnpaidConfirmStep(false)} className="btn-waw-ghost flex-1">
                                Back
                            </button>
                            <button onClick={() => confirmPayment(false)} className="btn-waw flex-1">
                                Start unpaid
                            </button>
                        </div>
                    )}
                </div>
            )}

            {paymentConfirmOpen && isComplimentary && (
                <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                        Complimentary
                    </p>
                    <h4 className="mb-2 text-xl font-black text-black">{room.name}</h4>
                    <p className="mb-1 text-lg font-bold capitalize text-black">{room.currentClient}</p>
                    <p className="mb-5 text-sm font-semibold text-black/55">
                        Invited by {room.invitedBy || 'staff'} · FREE
                    </p>
                    <button
                        type="button"
                        onClick={() => {
                            confirmedBookingsRef.current.add(room.bookingId);
                            setPaymentConfirmOpen(false);
                        }}
                        className="btn-waw min-w-[10rem]"
                    >
                        Start session
                    </button>
                </div>
            )}

            {payTargetId && (
                <div className="absolute inset-0 z-[65] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                        Payment method
                    </p>
                    <p className="mb-4 text-sm font-semibold text-black/55">How did they pay?</p>
                    <div className="w-full max-w-xs space-y-2">
                        {PAYMENT_METHODS.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => submitMarkPaid(m.id)}
                                className="btn-waw w-full"
                            >
                                {m.label}
                            </button>
                        ))}
                        <button
                            type="button"
                            onClick={() => setPayTargetId(null)}
                            className="btn-waw-ghost w-full"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {showUrgentAlert && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-600/95 p-6 text-center backdrop-blur-[2px]">
                    <p className="text-[12px] font-bold uppercase tracking-[0.2em] text-white/80">
                        Time up
                    </p>
                    <p className="mt-2 text-xl font-black text-white">{room.name}</p>
                    {room.currentClient && (
                        <p className="mt-1 text-sm font-semibold capitalize text-white/75">
                            {room.currentClient}
                        </p>
                    )}
                    <p className="my-6 font-mono text-5xl font-black tabular-nums text-white">
                        {countdownFormatted}
                    </p>
                    <button
                        type="button"
                        onClick={checkoutNow}
                        className="btn-waw min-w-[12rem]"
                    >
                        Check out now
                    </button>
                </div>
            )}

            {/* Slim room strip */}
            <div className="flex items-center justify-between gap-3 border-b-2 border-black px-4 py-2.5">
                <div className="min-w-0 flex items-baseline gap-2">
                    <h3 className="truncate text-[18px] font-black tracking-tight text-black">
                        {room.name}
                    </h3>
                    <span className="shrink-0 text-[12px] font-semibold text-black/40">
                        {room.capacity} max
                    </span>
                </div>
                <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                        isOccupied
                            ? 'bg-[#FFD400] text-black ring-2 ring-black'
                            : 'bg-black/5 text-black/55 ring-1 ring-black/20'
                    }`}
                >
                    {isOccupied ? 'Live' : 'Open'}
                </span>
            </div>

            <div className="flex flex-1 flex-col p-5">
                {isOccupied ? (
                    <>
                        {/* Dominant timer */}
                        <div className="mb-4 rounded-2xl border-2 border-black bg-[#FFFBEA] p-4">
                            <SessionRingTimer
                                percent={progressPercent}
                                countdown={countdownFormatted}
                                endsAt={room.checkoutTime}
                                secondsLeft={secondsLeft}
                            />
                        </div>

                        {/* Guest + meta — Mark paid stays one-tap (most common desk action) */}
                        <div className="mb-4 flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[18px] font-black capitalize text-black">
                                    {room.currentClient}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-semibold text-black/60">
                                    <span className="inline-flex items-center gap-1.5">
                                        <MetaIcon>
                                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                                <circle cx="9" cy="7" r="4" />
                                                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                                            </svg>
                                        </MetaIcon>
                                        {currentMembers}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <MetaIcon>
                                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                                <path d="M2 10h20" />
                                            </svg>
                                        </MetaIcon>
                                        {isComplimentary ? 'FREE' : `${currentPrice} DHS`}
                                    </span>
                                    <span
                                        className={`inline-flex items-center gap-1.5 ${
                                            isComplimentary || isClientPaid ? 'text-black' : 'text-red-600'
                                        }`}
                                    >
                                        <span
                                            className={`h-2 w-2 rounded-full ${
                                                isComplimentary || isClientPaid
                                                    ? 'bg-[#FFD400] ring-1 ring-black'
                                                    : 'bg-red-500'
                                            }`}
                                        />
                                        {isComplimentary
                                            ? `Invite · ${room.invitedBy || 'staff'}`
                                            : isClientPaid
                                              ? methodLabel || 'Paid'
                                              : 'Unpaid'}
                                    </span>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                                {!isComplimentary && (
                                    <button
                                        type="button"
                                        onClick={() => togglePaid(room.bookingId, !isClientPaid)}
                                        className={`rounded-xl border-2 border-black px-2.5 py-1.5 text-[11px] font-black transition ${
                                            isClientPaid
                                                ? 'bg-white text-black hover:bg-black/5'
                                                : 'bg-[#FFD400] text-black hover:bg-[#FFE14D]'
                                        }`}
                                    >
                                        {isClientPaid ? 'Paid ✓' : 'Mark paid'}
                                    </button>
                                )}
                                <OverflowMenu
                                    open={openMenu === 'active'}
                                    onToggle={() => setOpenMenu(openMenu === 'active' ? null : 'active')}
                                    items={[{ label: 'Edit session', onClick: openEditModal }]}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="mb-4 rounded-2xl border-2 border-dashed border-black/25 bg-[#F7F4EC] px-4 py-8 text-center">
                        <p className="text-[15px] font-black text-black">Room free</p>
                        <p className="mt-1 text-[13px] font-semibold text-black/50">
                            {room.nextStart
                                ? `Available ${freeDurationFormatted}`
                                : 'Available rest of day'}
                        </p>
                    </div>
                )}

                {awaiting && (
                    <div className="mb-4 rounded-xl border-2 border-black bg-[#FFF5F3] px-3 py-3">
                        <p className="text-[10px] font-black uppercase tracking-wide text-[#B42318]">
                            Waiting for check-in
                        </p>
                        <p className="mt-1 text-sm font-black capitalize text-black">
                            {awaiting.clientName}
                        </p>
                        <p className="text-xs font-semibold text-black/50">
                            Reserved {awaiting.start}–{awaiting.end} · 15 min grace
                        </p>
                        <div className="mt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={() => checkIn(awaiting.id)}
                                className="btn-waw flex-1 text-[12px]"
                            >
                                Check in
                            </button>
                            <button
                                type="button"
                                onClick={() => markNoShow(awaiting.id)}
                                className="btn-waw-ghost flex-1 text-[12px]"
                            >
                                No-show
                            </button>
                        </div>
                    </div>
                )}

                {/* Primary actions — yellow + black */}
                <div className="mb-5 flex flex-col gap-2 sm:flex-row">
                    <button onClick={() => onOpenBooking(room.id)} className="btn-waw flex-1">
                        New booking
                    </button>
                    {isOccupied && (
                        <button onClick={checkoutNow} className="btn-waw flex-1">
                            Check out
                        </button>
                    )}
                </div>

                {/* Upcoming */}
                <div className="mt-auto">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-black/40">
                        Up next
                    </p>
                    <div className="space-y-2">
                        {upcomingQueue.length > 0 ? (
                            upcomingQueue.map((b) => {
                                const origTime = (b.originalStart || b.original_start)
                                    ? new Date(`1970-01-01T${b.originalStart || b.original_start}`)
                                    : null;
                                const currTime = b.start ? new Date(`1970-01-01T${b.start}`) : null;
                                const pushedMins =
                                    origTime && currTime && currTime > origTime
                                        ? Math.round((currTime - origTime) / 60000)
                                        : 0;
                                const remainingPush = 10 - pushedMins;
                                const isMaxPushed = pushedMins >= 10;
                                const bookingMembers = b.members || 1;
                                const bookingComplimentary = toBool(b.isComplimentary);
                                const bookingPrice = bookingComplimentary ? 0 : calculatePrice(bookingMembers);
                                const bookingIsPaid = toBool(b.paid ?? b.is_paid);
                                const bookingMethod = paymentLabel(b.paymentMethod, bookingComplimentary);
                                const menuKey = `up-${b.id}`;
                                const deskBooking = isDeskBooking(b);

                                const menuItems = deskBooking
                                    ? [
                                          { label: 'Edit', onClick: () => openEditBookingModal(b) },
                                          { label: 'Check in', onClick: () => checkIn(b.id) },
                                      ]
                                    : [];
                                if (deskBooking && !isMaxPushed && remainingPush >= 10) {
                                    menuItems.push({ label: '+10 min', onClick: () => pushBooking(b.id, 10) });
                                }
                                if (deskBooking && pushedMins >= 5) {
                                    menuItems.push({ label: '−5 min', onClick: () => pushBooking(b.id, -5) });
                                }
                                if (deskBooking && pushedMins >= 10) {
                                    menuItems.push({ label: '−10 min', onClick: () => pushBooking(b.id, -10) });
                                }
                                if (deskBooking && bookingIsPaid && !bookingComplimentary) {
                                    menuItems.push({
                                        label: 'Mark unpaid',
                                        onClick: () => togglePaid(b.id, false),
                                    });
                                }
                                if (deskBooking) {
                                    menuItems.push({
                                        label: 'No-show',
                                        danger: true,
                                        onClick: () => markNoShow(b.id),
                                    });
                                    menuItems.push({
                                        label: 'Cancel',
                                        danger: true,
                                        onClick: () => cancelBooking(b.id),
                                    });
                                }

                                return (
                                    <div
                                        key={b.id}
                                        className={`flex items-center gap-2 rounded-xl border-2 border-black px-3 py-2.5 ${
                                            bookingComplimentary || bookingIsPaid
                                                ? 'bg-white'
                                                : 'bg-red-50'
                                        }`}
                                    >
                                        <div className="w-14 shrink-0 text-center">
                                            <p className="text-[14px] font-black tabular-nums text-black">
                                                {b.start}
                                            </p>
                                            <p className="text-[10px] font-bold tabular-nums text-black/40">
                                                {b.end}
                                            </p>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[14px] font-bold capitalize text-black">
                                                {b.clientName}
                                            </p>
                                            <p className="mt-0.5 text-[11px] font-semibold text-black/50">
                                                {bookingMembers} ·{' '}
                                                {bookingComplimentary ? 'FREE' : `${bookingPrice} DHS`}
                                                {pushedMins > 0 ? (
                                                    <span className="text-black/40"> · delayed +{pushedMins}m</span>
                                                ) : null}
                                                <span
                                                    className={
                                                        bookingComplimentary || bookingIsPaid
                                                            ? ' text-black'
                                                            : ' text-red-600'
                                                    }
                                                >
                                                    {' · '}
                                                    {bookingComplimentary
                                                        ? `Invite · ${b.invitedBy || 'staff'}`
                                                        : bookingIsPaid
                                                          ? bookingMethod || 'Paid'
                                                          : 'Unpaid'}
                                                </span>
                                            </p>
                                        </div>

                                        {!deskBooking && (
                                            <span className="shrink-0 rounded-lg border-2 border-black/20 bg-[#F7F4EC] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-black/45">
                                                Web
                                            </span>
                                        )}

                                        {deskBooking && !bookingIsPaid && !bookingComplimentary && (
                                            <button
                                                type="button"
                                                onClick={() => togglePaid(b.id, true)}
                                                className="shrink-0 rounded-lg border-2 border-black bg-[#FFD400] px-2 py-1.5 text-[11px] font-black text-black shadow-[1px_1px_0_#000] active:translate-y-px"
                                                title="Mark as paid"
                                            >
                                                Mark paid
                                            </button>
                                        )}

                                        {deskBooking && !isMaxPushed && remainingPush >= 5 && (
                                            <button
                                                type="button"
                                                onClick={() => pushBooking(b.id, 5)}
                                                className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border-2 border-black bg-white px-2 py-1.5 text-[11px] font-black text-black shadow-[1px_1px_0_#000] transition hover:bg-[#FFD400] active:translate-y-px"
                                                title="Add 5 minutes"
                                            >
                                                <span className="text-[13px] leading-none">+</span>
                                                5m
                                            </button>
                                        )}

                                        {deskBooking && menuItems.length > 0 && (
                                            <OverflowMenu
                                                open={openMenu === menuKey}
                                                onToggle={() =>
                                                    setOpenMenu(openMenu === menuKey ? null : menuKey)
                                                }
                                                items={menuItems}
                                            />
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <p className="rounded-xl border-2 border-dashed border-black/15 px-3 py-3 text-center text-[12px] font-semibold text-black/40">
                                No upcoming bookings
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {isEditingActive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-sm rounded-2xl border-2 border-black bg-[#FFFDF5] p-6">
                        <h3 className="mb-4 text-lg font-black text-black">Edit session</h3>
                        <form onSubmit={submitEditActive} className="space-y-4">
                            <div>
                                <label className="mb-1 block text-[12px] font-bold text-black/50">Name</label>
                                <input
                                    type="text"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    required
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-[12px] font-bold text-black/50">Start</label>
                                <input
                                    type="time"
                                    value={editStartTime}
                                    onChange={(e) => setEditStartTime(e.target.value)}
                                    required
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-[12px] font-bold text-black/50">Duration</label>
                                <div className="flex gap-2">
                                    {[30, 60, 90, 120].map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setEditDuration(m)}
                                            className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold ${
                                                editDuration === m
                                                    ? 'bg-[#FFD400] text-black'
                                                    : 'bg-white text-black'
                                            }`}
                                        >
                                            {m}m
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setIsEditingActive(false)}
                                    className="btn-waw-ghost flex-1"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn-waw flex-1">
                                    Save
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {editingBooking && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                    <div className="w-full max-w-sm rounded-2xl border-2 border-black bg-[#FFFDF5] p-6">
                        <h3 className="mb-4 text-lg font-black text-black">Edit reservation</h3>
                        <form onSubmit={submitEditBooking} className="space-y-4">
                            <div>
                                <label className="mb-1 block text-[12px] font-bold text-black/50">Name</label>
                                <input
                                    type="text"
                                    value={editBookingName}
                                    onChange={(e) => setEditBookingName(e.target.value)}
                                    required
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-[12px] font-bold text-black/50">Start</label>
                                <input
                                    type="time"
                                    value={editBookingStartTime}
                                    onChange={(e) => setEditBookingStartTime(e.target.value)}
                                    required
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-[12px] font-bold text-black/50">Duration</label>
                                <div className="flex gap-2">
                                    {[30, 60, 90, 120].map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setEditBookingDuration(m)}
                                            className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold ${
                                                editBookingDuration === m
                                                    ? 'bg-[#FFD400] text-black'
                                                    : 'bg-white text-black'
                                            }`}
                                        >
                                            {m}m
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingBooking(null)}
                                    className="btn-waw-ghost flex-1"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn-waw flex-1">
                                    Save
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
