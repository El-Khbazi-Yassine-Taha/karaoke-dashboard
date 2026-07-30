import { useEffect, useRef, useState } from 'react';

/**
 * Takes the serverTimestamp (unix seconds) Inertia sends down with the
 * page, computes the offset between server time and this browser's
 * clock once, then ticks a "now" value every second purely on the
 * client using that offset. No per-second network calls.
 */
export default function useServerSyncedClock(serverTimestamp) {
    const offsetRef = useRef(serverTimestamp * 1000 - Date.now());
    const [now, setNow] = useState(() => Date.now() + offsetRef.current);

    // Re-sync the offset whenever a fresh serverTimestamp arrives
    // (e.g. after the periodic status poll or a new booking reload).
    useEffect(() => {
        offsetRef.current = serverTimestamp * 1000 - Date.now();
    }, [serverTimestamp]);

    useEffect(() => {
        const id = setInterval(() => {
            setNow(Date.now() + offsetRef.current);
        }, 1000);

        return () => clearInterval(id);
    }, []);

    return now; // JS timestamp in ms, safe to use with new Date(now)
}