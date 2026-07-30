import React, { useState } from 'react';
import { usePage, router } from '@inertiajs/react';

export default function LiveAvailabilityHeader() {
    const { auth } = usePage().props;
    const [menuOpen, setMenuOpen] = useState(false);

    const userName = auth?.user?.username || auth?.user?.name || 'Staff';
    const isAdmin = Boolean(auth?.user?.is_admin);
    const showRoleBadge = isAdmin && String(userName).toLowerCase() !== 'admin';

    return (
        <header className="relative z-50 flex items-center justify-between gap-4 rounded-2xl border-2 border-black bg-[#FFFDF5] px-4 py-3 shadow-[3px_3px_0_#000] sm:px-5">
            <a href="/dashboard" className="flex shrink-0 items-center">
                <img
                    src="/images/waw-logo.png"
                    alt="WAW Karaoke"
                    className="h-14 w-auto object-contain sm:h-16"
                />
            </a>

            <div className="relative z-50 shrink-0">
                <button
                    type="button"
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="inline-flex items-center gap-2 rounded-xl border-2 border-black bg-[#FFD400] px-3 py-2 text-sm font-black text-black transition hover:bg-[#FFE14D]"
                >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-black text-[11px] font-black text-[#FFD400]">
                        {(userName || 'A').charAt(0).toUpperCase()}
                    </span>
                    <span className="max-w-[9rem] truncate capitalize">{userName}</span>
                    <svg
                        className={`h-3.5 w-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                </button>

                {menuOpen && (
                    <>
                        <button
                            type="button"
                            className="fixed inset-0 z-[90] cursor-default"
                            aria-label="Close menu"
                            onClick={() => setMenuOpen(false)}
                        />
                        <div className="absolute right-0 z-[100] mt-2 w-52 overflow-hidden rounded-xl border-2 border-black bg-[#FFFDF5] p-1.5 shadow-[3px_3px_0_#000]">
                            <div className="mb-1 border-b border-black/10 px-3 py-2">
                                <p className="truncate text-sm font-black capitalize text-black">
                                    {userName}
                                </p>
                                {showRoleBadge && (
                                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[#B89600]">
                                        Admin
                                    </p>
                                )}
                            </div>

                            {isAdmin && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        router.visit('/admin/users');
                                    }}
                                    className="w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold text-black transition hover:bg-[#FFD400]/50"
                                >
                                    Manage users
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => router.post('/logout')}
                                className="w-full rounded-lg px-3 py-2.5 text-left text-xs font-bold text-red-600 transition hover:bg-red-50"
                            >
                                Sign out
                            </button>
                        </div>
                    </>
                )}
            </div>
        </header>
    );
}
