import { formatCountdown, remainingSecondsUntil } from '../hooks/useServerSyncedClock';

export default function CountdownTimer({ targetIso, nowMs, label = 'Time remaining' }) {
    const secondsLeft = remainingSecondsUntil(targetIso, nowMs);

    return (
        <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-200/80">
                {label}
            </p>
            <p className="mt-2 font-mono text-4xl font-bold tabular-nums text-orange-100">
                {formatCountdown(secondsLeft)}
            </p>
            <p className="mt-1 text-sm text-orange-100/70">Updates every second using server time</p>
        </div>
    );
}
