import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { router } from '@inertiajs/react';
import SessionRingTimer from './SessionRingTimer';
import { deskVisit } from '../lib/deskVisit';

function localDateStr() {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const d = String(n.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Parse today's HH:mm in local time (avoid UTC date from toISOString). */
function parseLocalTodayTime(hhmm, iso = null) {
    if (iso) {
        const t = new Date(iso).getTime();
        if (!Number.isNaN(t)) return t;
    }
    if (!hhmm) return NaN;
    const raw = String(hhmm).length === 5 ? `${hhmm}:00` : String(hhmm);
    return new Date(`${localDateStr()}T${raw}`).getTime();
}

let sharedAudioCtx = null;
let continuousAlarmTimer = null;
let backgroundNotifTimer = null;

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
        window.removeEventListener('touchstart', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    // Keep audio alive when staff comes back to the tab
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            const ctx = getAudioContext();
            if (ctx) ctx.resume().catch(() => {});
        }
    });
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
        osc1.frequency.setValueAtTime(680, now);
        osc1.frequency.exponentialRampToValueAtTime(1400, now + 0.35);
        osc2.frequency.setValueAtTime(340, now);
        osc2.frequency.exponentialRampToValueAtTime(900, now + 0.35);
        gainNode.gain.setValueAtTime(0.85, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.55);

        osc1.connect(gainNode);
        osc2.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.55);
        osc2.stop(now + 0.55);
    } catch (e) {}
}

function showBrowserNotification(roomName, clientName, { silent = false } = {}) {
    try {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const notif = new Notification(`${roomName} — TIME UP`, {
            body: `${clientName || 'Guest'}'s session needs check-out now.`,
            requireInteraction: true,
            silent,
            tag: `room-alert-${roomName}`,
            renotify: true,
        });
        notif.onclick = () => {
            window.focus();
            notif.close();
        };
    } catch (e) {}
}

/** Looping alarm — keeps beeping while the overlay is up (also tries when tab is hidden). */
function startContinuousAlarm(roomName, clientName) {
    stopContinuousAlarm();
    playEmergencyAlarm();
    showBrowserNotification(roomName, clientName);

    continuousAlarmTimer = window.setInterval(() => {
        // WebAudio may be throttled in background tabs — still try
        playEmergencyAlarm();
    }, 900);

    // System notifications still alert when the staff is on another tab
    backgroundNotifTimer = window.setInterval(() => {
        if (document.visibilityState === 'hidden') {
            showBrowserNotification(roomName, clientName, { silent: false });
        }
    }, 4000);
}

function stopContinuousAlarm() {
    if (continuousAlarmTimer) {
        clearInterval(continuousAlarmTimer);
        continuousAlarmTimer = null;
    }
    if (backgroundNotifTimer) {
        clearInterval(backgroundNotifTimer);
        backgroundNotifTimer = null;
    }
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

function isWebReservation(item) {
    if (!item?.id) return false;
    if (item.source === 'agenda-waw' || item.source === 'reservation') return true;
    return String(item.id).startsWith('web-');
}

function reservationNumericId(item) {
    const id = String(item?.id ?? '');
    if (/^\d+$/.test(id)) return id;
    if (id.startsWith('web-')) {
        const num = id.slice(4);
        return /^\d+$/.test(num) ? num : null;
    }
    return null;
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
                right: Math.max(8, window.innerWidth - buttonRect.right),
                ...(openUpward
                    ? { bottom: window.innerHeight - buttonRect.top + 4 }
                    : { top: buttonRect.bottom + 4 }),
                zIndex: 9999,
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

    const handleToggle = (event) => {
        event.stopPropagation();
        onToggle();
    };

    const menuPortal =
        open && typeof document !== 'undefined'
            ? createPortal(
                  <>
                      <button
                          type="button"
                          className="fixed inset-0 z-[9998] cursor-default"
                          aria-label="Close menu"
                          onClick={onToggle}
                      />
                      <div
                          style={menuStyle ?? { visibility: 'hidden', position: 'fixed', zIndex: 9999 }}
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
                  </>,
                  document.body
              )
            : null;

    return (
        <div className="relative shrink-0">
            <button
                ref={buttonRef}
                type="button"
                onClick={handleToggle}
                className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-black/15 bg-white text-lg font-bold text-black transition hover:border-black hover:bg-[#FFD400]"
                aria-label="More actions"
            >
                ⋯
            </button>
            {menuPortal}
        </div>
    );
}

export default function RoomColumn({ room, rooms = [], onOpenBooking }) {
    const otherRoom = (rooms || []).find((r) => String(r.id) !== String(room.id));
    const isOccupied = room.state === 'occupied';
    const isAwaitingPayment = room.state === 'awaiting_payment' || Boolean(room.awaitingPayment);

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
    const [checkInTarget, setCheckInTarget] = useState(null);
    const [checkoutConfirmOpen, setCheckoutConfirmOpen] = useState(false);
    const [actionConfirm, setActionConfirm] = useState(null);
    const confirmedBookingsRef = useRef(new Set());
    const [openMenu, setOpenMenu] = useState(null);

    const isComplimentary = toBool(room.isComplimentary);
    const paymentMethod = room.paymentMethod || null;

    // Walk-in or due web reservation: show payment picker (timer not started yet)
    useEffect(() => {
        if (isAwaitingPayment && (room.bookingId || room.reservationId)) {
            setPaymentConfirmOpen(true);
            setUnpaidConfirmStep(false);
            setPaymentMethodPick(null);
            return;
        }

        if (!isOccupied && !isAwaitingPayment) {
            setPaymentConfirmOpen(false);
            setUnpaidConfirmStep(false);
            setPaymentMethodPick(null);
            setCheckoutConfirmOpen(false);
        }

        if (!isOccupied) {
            setCheckoutConfirmOpen(false);
        }
    }, [isAwaitingPayment, isOccupied, room.bookingId, room.reservationId]);

    function confirmPayment(paid, method = null) {
        if (!room.bookingId && !room.reservationId) return;
        if (room.bookingId) {
            confirmedBookingsRef.current.add(room.bookingId);
        }
        setLocalPaid(paid);
        setPaymentConfirmOpen(false);
        setUnpaidConfirmStep(false);
        setPaymentMethodPick(null);

        const payload = { paid: paid ? 1 : 0 };
        if (paid && method && method !== 'complimentary') {
            payload.payment_method = method;
        }

        // Web reservation due → create booking + start timer after payment choice
        if (isAwaitingPayment && room.reservationId) {
            router.post(`/reservations/${room.reservationId}/start-session`, payload, {
                ...deskVisit,
            });
            return;
        }

        // Local walk-in pending payment → start timer after payment choice
        if (isAwaitingPayment && room.bookingId) {
            router.post(`/bookings/${room.bookingId}/start-session`, payload, {
                ...deskVisit,
            });
            return;
        }

        if (!room.bookingId) return;
        router.post(`/bookings/${room.bookingId}/toggle-paid`, payload, deskVisit);
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
            deskVisit
        );
    }

    function markUnpaid(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;
        const isCurrent = String(bookingId) === String(room.bookingId);
        if (isCurrent) setLocalPaid(false);
        router.post(`/bookings/${bookingId}/toggle-paid`, { paid: 0 }, deskVisit);
    }

    function checkIn(bookingId) {
        if (!/^\d+$/.test(String(bookingId))) return;

        const fromAwaiting =
            room.awaitingCheckIn && String(room.awaitingCheckIn.id) === String(bookingId)
                ? room.awaitingCheckIn
                : null;
        const fromUpcoming = (room.upcoming || []).find((b) => String(b.id) === String(bookingId));
        const src = fromAwaiting || fromUpcoming;
        if (!src) return;

        setCheckInTarget({
            id: String(bookingId),
            clientName: src.clientName || 'Guest',
            members: Number(src.members) || 1,
            isComplimentary: toBool(src.isComplimentary),
            invitedBy: src.invitedBy || null,
        });
        setUnpaidConfirmStep(false);
        setPaymentMethodPick(null);
        setPaymentConfirmOpen(false);
        setPayTargetId(null);
        setCheckoutConfirmOpen(false);
    }

    function confirmCheckInPayment(paid, method = null) {
        if (!checkInTarget?.id) return;
        const id = checkInTarget.id;
        const payload = { paid: paid ? 1 : 0 };
        if (paid && method && method !== 'complimentary') {
            payload.payment_method = method;
        }

        setCheckInTarget(null);
        setUnpaidConfirmStep(false);
        setPaymentMethodPick(null);

        router.post(`/bookings/${id}/start-session`, payload, deskVisit);
    }

    function closeCheckInPayment() {
        setCheckInTarget(null);
        setUnpaidConfirmStep(false);
        setPaymentMethodPick(null);
    }

    function markNoShow(bookingId, clientName = 'Guest') {
        if (!/^\d+$/.test(String(bookingId))) return;
        setOpenMenu(null);
        setActionConfirm({
            type: 'no_show',
            kind: 'booking',
            id: String(bookingId),
            name: clientName,
        });
    }

    function askNoShowReservation(reservationId, clientName = 'Guest') {
        if (!reservationId) return;
        setOpenMenu(null);
        setPaymentConfirmOpen(false);
        setActionConfirm({
            type: 'no_show',
            kind: 'reservation',
            id: String(reservationId),
            name: clientName,
        });
    }

    function cancelBooking(bookingId, clientName = 'Guest') {
        if (!/^\d+$/.test(String(bookingId))) return;
        setOpenMenu(null);
        setActionConfirm({
            type: 'cancel',
            kind: 'booking',
            id: String(bookingId),
            name: clientName,
        });
    }

    function cancelReservation(item) {
        const id = reservationNumericId(item);
        if (!id) return;
        setOpenMenu(null);
        let name = item.clientName || 'Guest';
        if (typeof name === 'string' && name.startsWith('Web · ')) {
            name = name.slice(6);
        }
        setActionConfirm({
            type: 'cancel',
            kind: 'reservation',
            id: String(id),
            name,
        });
    }

    function switchBookingRoom(bookingId, clientName = 'Guest') {
        if (!otherRoom?.id || !/^\d+$/.test(String(bookingId))) return;
        setOpenMenu(null);
        setActionConfirm({
            type: 'switch_room',
            kind: 'booking',
            id: String(bookingId),
            name: clientName,
            targetRoomId: otherRoom.id,
            targetRoomName: otherRoom.name,
        });
    }

    function switchReservationRoom(item) {
        const id = reservationNumericId(item);
        if (!id || !otherRoom?.id) return;
        setOpenMenu(null);
        let name = item.clientName || 'Guest';
        if (typeof name === 'string' && name.startsWith('Web · ')) {
            name = name.slice(6);
        }
        setActionConfirm({
            type: 'switch_room',
            kind: 'reservation',
            id: String(id),
            name,
            targetRoomId: otherRoom.id,
            targetRoomName: otherRoom.name,
        });
    }

    function runActionConfirm() {
        if (!actionConfirm) return;
        const { type, kind, id, targetRoomId } = actionConfirm;
        setActionConfirm(null);

        if (type === 'no_show' && kind === 'booking') {
            router.post(`/bookings/${id}/no-show`, {}, deskVisit);
            return;
        }
        if (type === 'no_show' && kind === 'reservation') {
            router.post(`/reservations/${id}/no-show`, {}, deskVisit);
            return;
        }
        if (type === 'cancel' && kind === 'booking') {
            router.post(`/bookings/${id}/cancel`, {}, deskVisit);
            return;
        }
        if (type === 'cancel' && kind === 'reservation') {
            router.post(`/reservations/${id}/cancel`, {}, deskVisit);
            return;
        }
        if (type === 'switch_room' && kind === 'booking' && targetRoomId) {
            router.post(
                `/bookings/${id}/switch-room`,
                { room_id: targetRoomId },
                deskVisit
            );
            return;
        }
        if (type === 'switch_room' && kind === 'reservation' && targetRoomId) {
            router.post(
                `/reservations/${id}/switch-room`,
                { room_id: targetRoomId },
                deskVisit
            );
        }
    }

    const [msRemaining, setMsRemaining] = useState(() => {
        if (!isOccupied || !room.checkoutTimeIso) return 0;
        return Math.max(0, new Date(room.checkoutTimeIso).getTime() - Date.now());
    });

    const [msFreeRemaining, setMsFreeRemaining] = useState(() => {
        if (isOccupied || !room.nextStart) return 0;
        const t = parseLocalTodayTime(room.nextStart, room.nextStartIso);
        return Number.isNaN(t) ? 0 : Math.max(0, t - Date.now());
    });

    useEffect(() => {
        if (!isOccupied || !room.checkoutTimeIso) {
            setMsRemaining(0);
            return;
        }
        const targetTime = new Date(room.checkoutTimeIso).getTime();
        const updateTimer = () => setMsRemaining(Math.max(0, targetTime - Date.now()));
        updateTimer();
        const interval = setInterval(updateTimer, 250);
        return () => clearInterval(interval);
    }, [isOccupied, room.checkoutTimeIso]);

    useEffect(() => {
        if (isOccupied || !room.nextStart) {
            setMsFreeRemaining(0);
            return;
        }
        const targetTime = parseLocalTodayTime(room.nextStart, room.nextStartIso);
        if (Number.isNaN(targetTime)) {
            setMsFreeRemaining(0);
            return;
        }
        const updateFreeTimer = () => setMsFreeRemaining(Math.max(0, targetTime - Date.now()));
        updateFreeTimer();
        const interval = setInterval(updateFreeTimer, 250);
        return () => clearInterval(interval);
    }, [isOccupied, room.nextStart, room.nextStartIso]);

    const secondsLeft = Math.floor(msRemaining / 1000);
    const showUrgentAlert =
        isOccupied && secondsLeft <= 60 && !paymentConfirmOpen && !checkoutConfirmOpen && !actionConfirm;

    // Optimistic due-guest UI handles handoff — do NOT auto-reload here (caused yellow blank page).
    const prevFreeMsRef = useRef(null);
    useEffect(() => {
        prevFreeMsRef.current = msFreeRemaining;
    }, [msFreeRemaining]);

    // When live session countdown hits 0, check out once (not if already 0 on first paint)
    const autoCheckoutFiredForBooking = useRef(null);
    const prevSecondsLeftRef = useRef(null);
    useEffect(() => {
        const prev = prevSecondsLeftRef.current;
        prevSecondsLeftRef.current = secondsLeft;

        if (!isOccupied || !room.bookingId || secondsLeft > 0) return;
        if (prev == null || prev <= 0) return;
        if (autoCheckoutFiredForBooking.current === room.bookingId) return;
        autoCheckoutFiredForBooking.current = room.bookingId;
        router.post(`/bookings/${room.bookingId}/checkout`, {}, deskVisit);
    }, [isOccupied, room.bookingId, secondsLeft]);

    useEffect(() => {
        if (showUrgentAlert) {
            startContinuousAlarm(room.name, room.currentClient);
            return () => stopContinuousAlarm();
        }
        stopContinuousAlarm();
        return undefined;
    }, [showUrgentAlert, room.name, room.currentClient]);

    // Flash the browser tab title when staff is looking elsewhere
    useEffect(() => {
        if (!showUrgentAlert) return undefined;
        const original = document.title;
        let flip = false;
        const id = window.setInterval(() => {
            if (document.visibilityState !== 'hidden') {
                document.title = original;
                return;
            }
            flip = !flip;
            document.title = flip
                ? `⏰ TIME UP — ${room.name}`
                : original;
        }, 1000);
        return () => {
            clearInterval(id);
            document.title = original;
        };
    }, [showUrgentAlert, room.name]);

    function checkoutNow() {
        if (!room.bookingId) return;
        setCheckoutConfirmOpen(true);
        setPaymentConfirmOpen(false);
    }

    function confirmCheckout() {
        if (!room.bookingId) return;
        setCheckoutConfirmOpen(false);
        router.post(`/bookings/${room.bookingId}/checkout`, {}, deskVisit);
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

    function pushBooking(bookingId, minutes) {
        if (!/^\d+$/.test(String(bookingId))) return;
        router.post(`/bookings/${bookingId}/delay`, { minutes }, deskVisit);
    }

    function openEditModal() {
        setEditName(room.currentClient || '');
        setEditStartTime(room.startTime ? room.startTime.substring(0, 5) : '18:10');
        let mins = Number(room.durationMinutes) || 0;
        if (!mins && room.startTimeIso && room.checkoutTimeIso) {
            mins = Math.round(
                (new Date(room.checkoutTimeIso).getTime() - new Date(room.startTimeIso).getTime()) /
                    60000
            );
        }
        setEditDuration(Math.max(15, Math.min(480, mins || 60)));
        setIsEditingActive(true);
    }

    function previewEditEndTime() {
        if (!editStartTime || !editDuration) return '—';
        const [h, m] = editStartTime.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return '—';
        const total = h * 60 + m + Number(editDuration);
        const endH = Math.floor(total / 60) % 24;
        const endM = total % 60;
        return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }

    function extendSession(minutes) {
        if (!room.bookingId) return;
        router.post(
            `/bookings/${room.bookingId}/extend`,
            { minutes },
            deskVisit
        );
    }

    function openEditBookingModal(booking) {
        setEditingBooking(booking);
        let name = booking.clientName || '';
        if (isWebReservation(booking) && name.startsWith('Web · ')) {
            name = name.slice(6);
        }
        setEditBookingName(name);
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
            { ...deskVisit, onSuccess: () => setIsEditingActive(false) }
        );
    }

    function submitEditBooking(e) {
        e.preventDefault();
        if (!editingBooking?.id) return;

        const mins = Math.max(0, Math.min(100, Number(editBookingDuration) || 0));
        const payload = {
            client_name: editBookingName,
            start_clock_time: editBookingStartTime,
            duration_minutes: mins,
        };

        if (isDeskBooking(editingBooking)) {
            router.post(`/bookings/${editingBooking.id}/update`, payload, {
                ...deskVisit,
                onSuccess: () => setEditingBooking(null),
            });
            return;
        }

        const reservationId = reservationNumericId(editingBooking);
        if (!reservationId) return;

        router.post(`/reservations/${reservationId}/update`, payload, {
            ...deskVisit,
            onSuccess: () => setEditingBooking(null),
        });
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

    const upcomingQueue = useMemo(() => {
        if (!room.upcoming) return [];
        return room.upcoming.filter((b) => {
            const isCurrentActive = room.bookingId && String(b.id) === String(room.bookingId);
            const status = (b.status || '').toLowerCase();
            return (
                !isCurrentActive &&
                status !== 'completed' &&
                status !== 'cancelled' &&
                status !== 'no_show'
            );
        });
    }, [room.upcoming, room.bookingId]);

    const currentMembers = room.members || 1;
    const currentPrice = isComplimentary ? 0 : calculatePrice(currentMembers);
    const methodLabel = paymentLabel(paymentMethod, isComplimentary);

    // At next-start time, promote first local guest immediately (don't wait for 60s poll)
    const optimisticDue = useMemo(() => {
        if (isOccupied || isAwaitingPayment || room.awaitingCheckIn) return null;
        if (msFreeRemaining > 1000) return null;
        const next = upcomingQueue[0];
        if (!next || !/^\d+$/.test(String(next.id))) return null;
        if (room.nextStart && next.start && next.start !== room.nextStart) return null;
        return next;
    }, [
        isOccupied,
        isAwaitingPayment,
        room.awaitingCheckIn,
        room.nextStart,
        msFreeRemaining,
        upcomingQueue,
    ]);

    const awaiting = room.awaitingCheckIn || optimisticDue || null;
    const showDueCheckIn = Boolean(awaiting) && !isOccupied && !isAwaitingPayment;

    const displayUpcoming = useMemo(() => {
        if (!awaiting) return upcomingQueue;
        return upcomingQueue.filter((b) => String(b.id) !== String(awaiting.id));
    }, [upcomingQueue, awaiting]);

    return (
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border-2 border-black bg-white">
            {actionConfirm && (
                <div className="absolute inset-0 z-[75] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                        {actionConfirm.type === 'no_show'
                            ? 'No-show'
                            : actionConfirm.type === 'switch_room'
                              ? 'Switch room'
                              : 'Cancel'}
                    </p>
                    <h4 className="mb-2 text-xl font-black text-black">{room.name}</h4>
                    <p className="mb-1 text-lg font-bold capitalize text-black">
                        {actionConfirm.name || 'Guest'}
                    </p>
                    <p className="mb-6 text-sm font-semibold text-black/55">
                        {actionConfirm.type === 'no_show'
                            ? 'Guest did not arrive — will not count as paid.'
                            : actionConfirm.type === 'switch_room'
                              ? `Move to ${actionConfirm.targetRoomName || 'the other room'}?`
                              : 'Cancel this reservation?'}
                    </p>
                    <div className="flex w-full max-w-xs gap-2">
                        <button
                            type="button"
                            onClick={() => setActionConfirm(null)}
                            className="btn-waw-ghost flex-1"
                        >
                            Back
                        </button>
                        <button
                            type="button"
                            onClick={runActionConfirm}
                            className="btn-waw flex-1"
                        >
                            {actionConfirm.type === 'no_show'
                                ? 'Yes, no-show'
                                : actionConfirm.type === 'switch_room'
                                  ? 'Yes, switch'
                                  : 'Yes, cancel'}
                        </button>
                    </div>
                </div>
            )}

            {checkoutConfirmOpen && (
                <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                        Check out
                    </p>
                    <h4 className="mb-2 text-xl font-black text-black">{room.name}</h4>
                    <p className="mb-1 text-lg font-bold capitalize text-black">
                        {room.currentClient || 'Guest'}
                    </p>
                    <p className="mb-6 text-sm font-semibold text-black/55">
                        Free this room and end the session?
                    </p>
                    <div className="flex w-full max-w-xs gap-2">
                        <button
                            type="button"
                            onClick={() => setCheckoutConfirmOpen(false)}
                            className="btn-waw-ghost flex-1"
                        >
                            Cancel
                        </button>
                        <button type="button" onClick={confirmCheckout} className="btn-waw flex-1">
                            Yes, check out
                        </button>
                    </div>
                </div>
            )}

            {checkInTarget && !checkoutConfirmOpen && (
                <div className="absolute inset-0 z-[66] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    {checkInTarget.isComplimentary ? (
                        <>
                            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                                Check in · Complimentary
                            </p>
                            <h4 className="mb-2 text-xl font-black text-black">{room.name}</h4>
                            <p className="mb-1 text-lg font-bold capitalize text-black">
                                {checkInTarget.clientName}
                            </p>
                            <p className="mb-5 text-sm font-semibold text-black/55">
                                Invited by {checkInTarget.invitedBy || 'staff'} · FREE
                            </p>
                            <div className="flex w-full max-w-xs gap-2">
                                <button
                                    type="button"
                                    onClick={closeCheckInPayment}
                                    className="btn-waw-ghost flex-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => confirmCheckInPayment(true, 'complimentary')}
                                    className="btn-waw flex-1"
                                >
                                    Start session
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">
                                Check in · Payment
                            </p>
                            <h4 className="mb-2 text-xl font-black text-black">{room.name}</h4>
                            <p className="mb-1 text-lg font-bold capitalize text-black">
                                {checkInTarget.clientName}
                            </p>
                            <p className="mb-2 text-sm font-semibold text-black/55">
                                {checkInTarget.members} guests ·{' '}
                                {calculatePrice(checkInTarget.members)} DHS
                            </p>
                            <p className="mb-4 text-xs font-bold text-[#8A7400]">
                                Choose payment — timer starts after you confirm
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
                                                onClick={() => confirmCheckInPayment(true, m.id)}
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
                                    <div className="w-full max-w-xs space-y-2">
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setPaymentMethodPick(true)}
                                                className="btn-waw flex-1"
                                            >
                                                Paid
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setUnpaidConfirmStep(true)}
                                                className="btn-waw-ghost flex-1"
                                            >
                                                Unpaid
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={closeCheckInPayment}
                                            className="btn-waw-ghost w-full"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                )
                            ) : (
                                <div className="flex w-full max-w-xs gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setUnpaidConfirmStep(false)}
                                        className="btn-waw-ghost flex-1"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => confirmCheckInPayment(false)}
                                        className="btn-waw flex-1"
                                    >
                                        Start unpaid
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {paymentConfirmOpen && !isComplimentary && !checkoutConfirmOpen && !checkInTarget && (
                <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-[#FFFDF5] p-6 text-center">
                    <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-black/40">Payment</p>
                    <h4 className="mb-4 text-xl font-black text-black">{room.name}</h4>
                    <p className="mb-1 text-lg font-bold capitalize text-black">{room.currentClient}</p>
                    <p className="mb-2 text-sm font-semibold text-black/55">
                        {currentMembers} guests · {currentPrice} DHS
                    </p>
                    {isAwaitingPayment && (
                        <p className="mb-3 text-xs font-bold text-[#8A7400]">
                            {room.awaitingWebPayment
                                ? `Web booking${room.reservedSlot ? ` (${room.reservedSlot})` : ''} — timer starts after payment`
                                : 'Timer starts only after you choose a payment method'}
                        </p>
                    )}
                    {!isAwaitingPayment && <div className="mb-5" />}
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
                                {room.reservationId && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            askNoShowReservation(
                                                room.reservationId,
                                                room.currentClient || 'Guest'
                                            )
                                        }
                                        className="w-full rounded-lg px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                                    >
                                        No-show
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setPaymentMethodPick(true)}
                                        className="btn-waw flex-1"
                                    >
                                        Paid
                                    </button>
                                    <button
                                        onClick={() => setUnpaidConfirmStep(true)}
                                        className="btn-waw-ghost flex-1"
                                    >
                                        Unpaid
                                    </button>
                                </div>
                                {room.reservationId && (
                                    <button
                                        type="button"
                                        onClick={() =>
                                            askNoShowReservation(
                                                room.reservationId,
                                                room.currentClient || 'Guest'
                                            )
                                        }
                                        className="w-full rounded-lg px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                                    >
                                        No-show
                                    </button>
                                )}
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

            {paymentConfirmOpen && isComplimentary && !checkoutConfirmOpen && !checkInTarget && (
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
                            if (isAwaitingPayment && room.bookingId) {
                                confirmPayment(true, 'complimentary');
                                return;
                            }
                            confirmedBookingsRef.current.add(room.bookingId);
                            setPaymentConfirmOpen(false);
                        }}
                        className="btn-waw min-w-[10rem]"
                    >
                        Start session
                    </button>
                </div>
            )}

            {payTargetId && !checkInTarget && (
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
                <div className="urgent-timeup-overlay absolute inset-0 z-50 flex flex-col items-center justify-center p-6 text-center">
                    <p className="urgent-timeup-label text-[12px] font-bold uppercase tracking-[0.2em]">
                        Time up
                    </p>
                    <p className="urgent-timeup-title mt-2 text-xl font-black">{room.name}</p>
                    {room.currentClient && (
                        <p className="urgent-timeup-sub mt-1 text-sm font-semibold capitalize">
                            {room.currentClient}
                        </p>
                    )}
                    <p className="urgent-timeup-clock my-6 font-mono text-5xl font-black tabular-nums">
                        {countdownFormatted}
                    </p>
                    <button
                        type="button"
                        onClick={checkoutNow}
                        className="btn-waw min-w-[12rem] shadow-[0_0_24px_rgba(255,212,0,0.55)]"
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
                                    {room.currentClientPhone ? (
                                        <a
                                            href={`tel:${String(room.currentClientPhone).replace(/\s+/g, '')}`}
                                            className="inline-flex items-center gap-1.5 text-black hover:underline"
                                            title="Call guest"
                                        >
                                            <MetaIcon>
                                                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.74.34 1.53.57 2.34.7A2 2 0 0 1 22 16.92z" />
                                                </svg>
                                            </MetaIcon>
                                            {room.currentClientPhone}
                                        </a>
                                    ) : null}
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
                                    onToggle={() =>
                                        setOpenMenu((prev) => (prev === 'active' ? null : 'active'))
                                    }
                                    items={[
                                        { label: 'Edit session', onClick: openEditModal },
                                        ...(otherRoom
                                            ? [
                                                  {
                                                      label: `Switch to ${otherRoom.name}`,
                                                      onClick: () =>
                                                          switchBookingRoom(
                                                              room.bookingId,
                                                              room.currentClient || 'Guest'
                                                          ),
                                                  },
                                              ]
                                            : []),
                                        {
                                            label: 'No-show',
                                            danger: true,
                                            onClick: () =>
                                                markNoShow(
                                                    room.bookingId,
                                                    room.currentClient || 'Guest'
                                                ),
                                        },
                                    ]}
                                />
                            </div>
                        </div>
                    </>
                ) : isAwaitingPayment ? (
                    <div className="mb-4 rounded-2xl border-2 border-dashed border-black/25 bg-[#FFF5F3] px-4 py-8 text-center">
                        <p className="text-[15px] font-black capitalize text-black">
                            {room.currentClient}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-[#B42318]">
                            {room.awaitingWebPayment
                                ? `Web reservation${room.reservedSlot ? ` · ${room.reservedSlot}` : ''} — choose payment to start`
                                : 'Waiting for payment — timer not started'}
                        </p>
                    </div>
                ) : showDueCheckIn ? (
                    <div className="mb-4 rounded-2xl border-2 border-black bg-[#FFF5F3] px-4 py-6 text-center">
                        <p className="text-[10px] font-black uppercase tracking-wide text-[#B42318]">
                            Session due now
                        </p>
                        <p className="mt-1 text-[15px] font-black capitalize text-black">
                            {awaiting.clientName}
                        </p>
                        <p className="mt-1 text-[13px] font-semibold text-black/50">
                            Reserved {awaiting.start}–{awaiting.end}
                        </p>
                        <div className="mt-3 flex gap-2">
                            <button
                                type="button"
                                onClick={() => checkIn(awaiting.id)}
                                className="btn-waw flex-1 text-[12px]"
                            >
                                Check in
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    markNoShow(awaiting.id, awaiting.clientName || 'Guest')
                                }
                                className="btn-waw-ghost flex-1 text-[12px]"
                            >
                                No-show
                            </button>
                        </div>
                    </div>
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

                {awaiting && !showDueCheckIn && (
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
                        {isOccupied ? (
                            <p className="mt-2 text-[12px] font-bold text-[#B42318]">
                                Room is live — check out {room.currentClient} first before checking in.
                            </p>
                        ) : (
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
                                    onClick={() =>
                                        markNoShow(awaiting.id, awaiting.clientName || 'Guest')
                                    }
                                    className="btn-waw-ghost flex-1 text-[12px]"
                                >
                                    No-show
                                </button>
                            </div>
                        )}
                        {isOccupied && (
                            <div className="mt-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        markNoShow(awaiting.id, awaiting.clientName || 'Guest')
                                    }
                                    className="btn-waw-ghost w-full text-[12px]"
                                >
                                    No-show
                                </button>
                            </div>
                        )}
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
                        {displayUpcoming.length > 0 ? (
                            displayUpcoming.map((b) => {
                                const origTime = (b.originalStart || b.original_start)
                                    ? new Date(`1970-01-01T${b.originalStart || b.original_start}`)
                                    : null;
                                const currTime = b.start ? new Date(`1970-01-01T${b.start}`) : null;
                                const pushedMins =
                                    origTime && currTime && currTime > origTime
                                        ? Math.round((currTime - origTime) / 60000)
                                        : 0;
                                const bookingMembers = b.members || 1;
                                const bookingComplimentary = toBool(b.isComplimentary);
                                const bookingPrice = bookingComplimentary ? 0 : calculatePrice(bookingMembers);
                                const bookingIsPaid = toBool(b.paid ?? b.is_paid);
                                const bookingMethod = paymentLabel(b.paymentMethod, bookingComplimentary);
                                const menuKey = `up-${b.id}`;
                                const deskBooking = isDeskBooking(b);
                                const webReservation = isWebReservation(b);

                                const menuItems = deskBooking
                                    ? [
                                          { label: 'Edit', onClick: () => openEditBookingModal(b) },
                                          ...(!isOccupied
                                              ? [{ label: 'Check in', onClick: () => checkIn(b.id) }]
                                              : []),
                                          ...(otherRoom
                                              ? [
                                                    {
                                                        label: `Switch to ${otherRoom.name}`,
                                                        onClick: () =>
                                                            switchBookingRoom(
                                                                b.id,
                                                                b.clientName || 'Guest'
                                                            ),
                                                    },
                                                ]
                                              : []),
                                          {
                                              label: 'No-show',
                                              danger: true,
                                              onClick: () =>
                                                  markNoShow(b.id, b.clientName || 'Guest'),
                                          },
                                          {
                                              label: 'Cancel',
                                              danger: true,
                                              onClick: () =>
                                                  cancelBooking(b.id, b.clientName || 'Guest'),
                                          },
                                      ]
                                    : webReservation
                                      ? [
                                            { label: 'Edit', onClick: () => openEditBookingModal(b) },
                                            ...(otherRoom
                                                ? [
                                                      {
                                                          label: `Switch to ${otherRoom.name}`,
                                                          onClick: () => switchReservationRoom(b),
                                                      },
                                                  ]
                                                : []),
                                            {
                                                label: 'No-show',
                                                danger: true,
                                                onClick: () => {
                                                    const id = reservationNumericId(b);
                                                    if (!id) return;
                                                    let name = b.clientName || 'Guest';
                                                    if (
                                                        typeof name === 'string' &&
                                                        name.startsWith('Web · ')
                                                    ) {
                                                        name = name.slice(6);
                                                    }
                                                    askNoShowReservation(id, name);
                                                },
                                            },
                                            {
                                                label: 'Cancel',
                                                danger: true,
                                                onClick: () => cancelReservation(b),
                                            },
                                        ]
                                      : [];

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
                                                {b.clientPhone ? (
                                                    <a
                                                        href={`tel:${String(b.clientPhone).replace(/\s+/g, '')}`}
                                                        className="ml-1 text-black hover:underline"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        · {b.clientPhone}
                                                    </a>
                                                ) : null}
                                            </p>
                                        </div>

                                        {webReservation && (
                                            <span className="shrink-0 rounded-lg border-2 border-black/20 bg-[#F7F4EC] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-black/45">
                                                Web
                                            </span>
                                        )}

                                        {deskBooking && (
                                            <span className="shrink-0 rounded-lg border-2 border-black/20 bg-[#FFFBEA] px-2 py-1 text-[10px] font-black uppercase tracking-wide text-black/55">
                                                Local
                                            </span>
                                        )}

                                        {menuItems.length > 0 && (
                                            <OverflowMenu
                                                open={openMenu === menuKey}
                                                onToggle={() =>
                                                    setOpenMenu((prev) =>
                                                        prev === menuKey ? null : menuKey
                                                    )
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
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
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
                                <label className="mb-1 block text-[12px] font-bold text-black/50">
                                    Started at
                                </label>
                                <input
                                    type="time"
                                    value={editStartTime}
                                    onChange={(e) => setEditStartTime(e.target.value)}
                                    required
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-[12px] font-bold text-black/50">
                                    Duration
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {[30, 60, 90, 120, 150, 180].map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setEditDuration(m)}
                                            className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold ${
                                                Number(editDuration) === m
                                                    ? 'bg-[#FFD400] text-black'
                                                    : 'bg-white text-black hover:bg-[#FFD400]/50'
                                            }`}
                                        >
                                            {m}m
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={1}
                                        placeholder="0–100"
                                        value={
                                            [30, 60, 90, 120, 150, 180].includes(Number(editDuration))
                                                ? ''
                                                : editDuration
                                        }
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === '') {
                                                setEditDuration('');
                                                return;
                                            }
                                            const n = parseInt(v, 10);
                                            if (!Number.isFinite(n)) return;
                                            setEditDuration(Math.max(0, Math.min(100, n)));
                                        }}
                                        className="w-[7.5rem] rounded-lg border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black outline-none focus:bg-[#FFD400]/30"
                                    />
                                </div>
                                <p className="mt-1.5 text-[11px] font-semibold text-black/45">
                                    Or type any minutes (0–100)
                                </p>
                                <p className="mt-2 text-[12px] font-bold text-black">
                                    Ends at{' '}
                                    <span className="tabular-nums text-[#8A7400]">
                                        {previewEditEndTime()}
                                    </span>
                                </p>
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
                                <div className="flex flex-wrap gap-2">
                                    {[30, 60, 90, 120].map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setEditBookingDuration(m)}
                                            className={`rounded-lg border-2 border-black px-3 py-1.5 text-xs font-bold ${
                                                Number(editBookingDuration) === m
                                                    ? 'bg-[#FFD400] text-black'
                                                    : 'bg-white text-black'
                                            }`}
                                        >
                                            {m}m
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={1}
                                        placeholder="0–100"
                                        value={
                                            [30, 60, 90, 120].includes(Number(editBookingDuration))
                                                ? ''
                                                : editBookingDuration
                                        }
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === '') {
                                                setEditBookingDuration('');
                                                return;
                                            }
                                            const n = parseInt(v, 10);
                                            if (!Number.isFinite(n)) return;
                                            setEditBookingDuration(Math.max(0, Math.min(100, n)));
                                        }}
                                        className="w-[7.5rem] rounded-lg border-2 border-black bg-white px-2 py-1.5 text-xs font-bold text-black outline-none focus:bg-[#FFD400]/30"
                                    />
                                </div>
                                <p className="mt-1.5 text-[11px] font-semibold text-black/45">
                                    Or type any minutes (0–100)
                                </p>
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
