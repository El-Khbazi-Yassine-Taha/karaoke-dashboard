import React from 'react';
import { useForm } from '@inertiajs/react';

export default function Login() {
    const { data, setData, post, processing, errors } = useForm({
        username: '',
        password: '',
    });

    function submit(e) {
        e.preventDefault();
        post('/login');
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#FFD400] px-4 py-10">
            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-20 waw-bg-drift"
                style={{
                    backgroundImage: `url("/images/bacground-waw.svg")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />

            <div className="relative z-10 w-full max-w-[400px] rounded-2xl border-2 border-black bg-[#FFFDF5] p-8 shadow-[4px_4px_0_#000] sm:p-9">
                <img
                    src="/images/waw-logo.png"
                    alt="WAW Karaoke"
                    className="mx-auto mb-5 h-[4.75rem] w-auto sm:h-[5.25rem]"
                />

                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-black text-black">Staff login</h1>
                    <p className="mt-1 text-sm font-semibold text-black/50">
                        Manage rooms & reservations
                    </p>
                </div>

                <form onSubmit={submit} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-sm font-bold text-black">
                            Username
                        </label>
                        <input
                            type="text"
                            value={data.username}
                            onChange={(e) => setData('username', e.target.value)}
                            autoFocus
                            className="w-full rounded-xl border-2 border-black bg-white px-3.5 py-3 text-[15px] font-semibold text-black outline-none transition placeholder:font-medium placeholder:text-black/35 focus:bg-[#FFD400]/25"
                            placeholder="Username"
                        />
                        {errors.username && (
                            <p className="mt-1.5 text-sm font-semibold text-red-600">{errors.username}</p>
                        )}
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-bold text-black">
                            Password
                        </label>
                        <input
                            type="password"
                            value={data.password}
                            onChange={(e) => setData('password', e.target.value)}
                            className="w-full rounded-xl border-2 border-black bg-white px-3.5 py-3 text-[15px] font-semibold text-black outline-none transition placeholder:font-medium placeholder:text-black/35 focus:bg-[#FFD400]/25"
                            placeholder="Password"
                        />
                        {errors.password && (
                            <p className="mt-1.5 text-sm font-semibold text-red-600">{errors.password}</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={processing}
                        className="mt-2 flex w-full items-center justify-center rounded-xl border-2 border-black bg-[#FFD400] px-4 py-3.5 text-[15px] font-black text-black transition hover:bg-[#FFE14D] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {processing ? 'Signing in…' : 'Sign in'}
                    </button>
                </form>
            </div>
        </div>
    );
}
