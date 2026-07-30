export default function BottleTimer({ percent }) {
    const clamped = Math.min(100, Math.max(0, percent));
    const waveOffset = 120 - (clamped / 100) * 120;

    const colors =
        clamped >= 90
            ? { top: '#f87171', bottom: '#b91c1c', label: 'text-red-400' }
            : clamped >= 70
            ? { top: '#fbbf24', bottom: '#b45309', label: 'text-amber-400' }
            : { top: '#34d399', bottom: '#047857', label: 'text-amber-400' };

    return (
        <div className="flex items-center gap-4">
            <div className="relative h-24 w-12 shrink-0">
                <svg viewBox="0 0 60 120" className="h-full w-full drop-shadow-lg">
                    <defs>
                        <clipPath id="bottleClip">
                            <path d="M20,4 h20 v14 c10,6 14,16 14,26 v58 a6,6 0 0 1 -6,6 h-36 a6,6 0 0 1 -6,-6 v-58 c0,-10 4,-20 14,-26 z" />
                        </clipPath>
                        <linearGradient id="liquidGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={colors.top} />
                            <stop offset="100%" stopColor={colors.bottom} />
                        </linearGradient>
                    </defs>

                    {/* Bottle Background */}
                    <path
                        d="M20,4 h20 v14 c10,6 14,16 14,26 v58 a6,6 0 0 1 -6,6 h-36 a6,6 0 0 1 -6,-6 v-58 c0,-10 4,-20 14,-26 z"
                        fill="rgba(15,23,42,0.6)"
                        stroke="rgba(148,163,184,0.4)"
                        strokeWidth="2"
                    />

                    <g clipPath="url(#bottleClip)">
                        {/* Moving Liquid Group: Handles Vertical Offset safely without fighting CSS */}
                        <g style={{ transform: `translateY(${waveOffset}px)`, transition: 'transform 1s linear' }}>
                            {/* The Main Liquid Body */}
                            <rect
                                x="0"
                                y="0"
                                width="60"
                                height="120"
                                fill="url(#liquidGradient)"
                            />
                            {/* The Surface Wave (Wider than viewbox so it doesn't show edges when swaying) */}
                            <path
                                className="bottle-wave"
                                d="M-10,0 Q15,-5 30,0 T70,0 V10 H-10 Z"
                                fill={colors.top}
                                opacity="0.55"
                            />
                        </g>

                        {/* Bubbles */}
                        <circle className="bottle-bubble bottle-bubble-1" cx="20" cy="105" r="1.5" fill="white" opacity="0.5" />
                        <circle className="bottle-bubble bottle-bubble-2" cx="36" cy="95" r="1" fill="white" opacity="0.4" />
                        <circle className="bottle-bubble bottle-bubble-3" cx="28" cy="110" r="1.2" fill="white" opacity="0.45" />
                    </g>

                    {/* Bottle Glass Highlight Reflection */}
                    <path
                        d="M16,30 q-2,30 0,70"
                        stroke="white"
                        strokeWidth="2"
                        opacity="0.15"
                        fill="none"
                        strokeLinecap="round"
                    />
                </svg>

                {/* Completely Static CSS */}
                <style>{`
                    .bottle-wave {
                        animation: bottleWaveSway 2.4s ease-in-out infinite;
                    }
                    @keyframes bottleWaveSway {
                        0%, 100% { transform: translateX(0); }
                        50% { transform: translateX(4px); }
                    }
                    .bottle-bubble {
                        animation: bottleBubbleRise 3s ease-in infinite;
                    }
                    .bottle-bubble-1 { animation-delay: 0s; }
                    .bottle-bubble-2 { animation-delay: 1s; }
                    .bottle-bubble-3 { animation-delay: 2s; }
                    @keyframes bottleBubbleRise {
                        0% { transform: translateY(0); opacity: 0; }
                        10% { opacity: 0.6; }
                        90% { opacity: 0.15; }
                        100% { transform: translateY(-85px); opacity: 0; }
                    }
                `}</style>
            </div>

            <div className="flex-1">
                <div className="mb-2 flex justify-between text-xs font-bold text-slate-400">
                    <span>SESSION PROGRESS</span>
                    <span className={colors.label}>{Math.round(clamped)}% FULL</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{
                            width: `${clamped}%`,
                            background: `linear-gradient(90deg, ${colors.bottom}, ${colors.top})`,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}