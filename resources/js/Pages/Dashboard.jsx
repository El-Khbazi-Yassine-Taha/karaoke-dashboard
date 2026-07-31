import { useEffect, useState } from 'react';
import { router, usePage } from '@inertiajs/react';
import LiveAvailabilityHeader from '../Components/LiveAvailabilityHeader';
import QuickBookingModal from '../Components/QuickBookingModal';
import RoomColumn from '../Components/RoomColumn';
import HistoryModal from '../Components/HistoryModal';
import KaraokeBackground from '../Components/KaraokeBackground';
import AgendaView from '@/Components/AgendaView';

export default function Dashboard({
    rooms = [],
    summary = [],
    serverTime,
    serverTimestamp,
    durationPresets,
    reservations = [],
}) {
    const { flash, errors } = usePage().props;
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedRoomId, setSelectedRoomId] = useState(null);
    const [historyOpen, setHistoryOpen] = useState(false);

    const errorMessage =
        errors?.check_in || errors?.start || errors?.room_id || errors?.booking || null;

    useEffect(() => {
        const interval = window.setInterval(async () => {
            try {
                const response = await fetch('/dashboard/status', {
                    headers: {
                        Accept: 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                });
                if (!response.ok) return;
                router.reload({
                    only: ['rooms', 'summary', 'serverTime', 'serverTimestamp', 'reservations'],
                    preserveScroll: true,
                    preserveState: true,
                });
            } catch {
                // keep local timers running
            }
        }, 60000);
        return () => window.clearInterval(interval);
    }, []);

    const handleOpenBooking = (roomId = null) => {
        setSelectedRoomId(roomId);
        setModalOpen(true);
    };

    return (
        <KaraokeBackground>
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
                <div className="flex flex-col gap-5">
                    <div className="relative z-50 page-rise">
                        <LiveAvailabilityHeader serverTimestamp={serverTimestamp} />
                    </div>

                    {flash?.success && (
                        <div className="page-rise rounded-xl border-2 border-black bg-[#FFD400]/85 px-4 py-3 text-sm font-bold text-black backdrop-blur-sm">
                            {flash.success}
                        </div>
                    )}

                    {errorMessage && (
                        <div className="page-rise rounded-xl border-2 border-black bg-[#FFF5F3] px-4 py-3 text-sm font-bold text-[#B42318]">
                            {errorMessage}
                        </div>
                    )}

                    <div className="page-rise page-rise-delay-1 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => handleOpenBooking(null)} className="btn-waw">
                            New booking
                        </button>
                        <button type="button" onClick={() => setHistoryOpen(true)} className="btn-waw-ghost">
                            History
                        </button>
                    </div>

                    <div className="page-rise page-rise-delay-2 grid gap-5 lg:grid-cols-2">
                        {rooms &&
                            rooms
                                .filter(
                                    (room, index, self) =>
                                        self.findIndex((r) => r.name === room.name) === index
                                )
                                .map((room) => (
                                    <RoomColumn
                                        key={room.id}
                                        room={room}
                                        onOpenBooking={handleOpenBooking}
                                    />
                                ))}
                    </div>

                    <div className="page-rise page-rise-delay-3">
                        <AgendaView reservations={reservations} rooms={rooms} />
                    </div>
                </div>

                <QuickBookingModal
                    rooms={rooms}
                    durationPresets={durationPresets}
                    open={modalOpen}
                    onClose={() => {
                        setModalOpen(false);
                        setSelectedRoomId(null);
                    }}
                    selectedRoomId={selectedRoomId}
                />
                <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
            </div>
        </KaraokeBackground>
    );
}
