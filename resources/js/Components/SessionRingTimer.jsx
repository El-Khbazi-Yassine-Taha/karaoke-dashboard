export default function SessionRingTimer({ percent, countdown, endsAt, secondsLeft }) {
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
    const remaining = Math.max(0, 100 - clamped);

    // Time-based urgency wins over % — staff can spot a dying session across the room
    const secs = Number.isFinite(Number(secondsLeft)) ? Number(secondsLeft) : null;
    const phase =
        secs != null
            ? secs <= 180
                ? 'critical'
                : secs <= 600
                ? 'warn'
                : 'ok'
            : clamped >= 90
            ? 'critical'
            : clamped >= 70
            ? 'warn'
            : 'ok';

    const size = 120;
    const stroke = 10;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - remaining / 100);

    const ring =
        phase === 'critical' ? '#DC2626' : phase === 'warn' ? '#F59E0B' : '#FFD400';
    const track =
        phase === 'critical' ? '#FECACA' : phase === 'warn' ? '#FDE68A' : '#E8E4D0';

    return (
        <div className="flex items-center gap-4">
            <div className="relative shrink-0" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        stroke={track}
                        strokeWidth={stroke}
                    />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={r}
                        fill="none"
                        stroke={ring}
                        strokeWidth={stroke}
                        strokeLinecap="round"
                        strokeDasharray={c}
                        strokeDashoffset={offset}
                        className="transition-[stroke-dashoffset,stroke] duration-1000 ease-linear"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                        className={`text-[26px] font-black tabular-nums leading-none tracking-tight ${
                            phase === 'critical' ? 'text-red-600' : 'text-black'
                        }`}
                    >
                        {countdown}
                    </span>
                    <span className="mt-1 text-[9px] font-bold uppercase tracking-wider text-black/40">
                        left
                    </span>
                </div>
            </div>

            <div className="min-w-0 flex-1">
                <p
                    className={`text-[11px] font-bold uppercase tracking-[0.12em] ${
                        phase === 'critical'
                            ? 'text-red-600'
                            : phase === 'warn'
                            ? 'text-amber-600'
                            : 'text-black/40'
                    }`}
                >
                    {phase === 'critical'
                        ? 'Ending soon'
                        : phase === 'warn'
                        ? 'Wrapping up'
                        : 'Session'}
                </p>
                {endsAt && (
                    <p className="mt-1.5 text-[16px] font-black tabular-nums text-black">
                        Ends {endsAt}
                    </p>
                )}
                <p className="mt-1 text-[13px] font-semibold text-black/50">
                    {Math.round(remaining)}% remaining
                </p>
            </div>
        </div>
    );
}
