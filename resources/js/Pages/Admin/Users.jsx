import React, { useState } from 'react';
import { Head, Link, router, useForm, usePage } from '@inertiajs/react';

const field =
    'w-full rounded-xl border-2 border-black bg-white px-3 py-2.5 text-sm font-semibold text-black outline-none transition placeholder:font-medium placeholder:text-black/35 focus:bg-[#FFD400]/20';

export default function Users({ users = [], authUserId }) {
    const { flash, errors: pageErrors } = usePage().props;
    const [editingUser, setEditingUser] = useState(null);
    const [openMenu, setOpenMenu] = useState(null);

    const createForm = useForm({
        username: '',
        password: '',
        password_confirmation: '',
    });

    const editForm = useForm({
        username: '',
        password: '',
        password_confirmation: '',
    });

    function submitCreate(e) {
        e.preventDefault();
        createForm.post('/admin/users', {
            onSuccess: () => createForm.reset('username', 'password', 'password_confirmation'),
        });
    }

    function openEdit(user) {
        setEditingUser(user);
        setOpenMenu(null);
        editForm.setData({
            username: user.username,
            password: '',
            password_confirmation: '',
        });
        editForm.clearErrors();
    }

    function closeEdit() {
        setEditingUser(null);
        editForm.reset();
        editForm.clearErrors();
    }

    function submitEdit(e) {
        e.preventDefault();
        editForm.put(`/admin/users/${editingUser.id}`, {
            onSuccess: () => closeEdit(),
        });
    }

    function deleteUser(user) {
        if (user.id === authUserId) return;
        if (!window.confirm(`Delete account "${user.username}"? This cannot be undone.`)) return;
        setOpenMenu(null);
        router.delete(`/admin/users/${user.id}`);
    }

    return (
        <div className="relative min-h-screen overflow-hidden bg-[#FFD400]">
            <Head title="Manage users" />

            <div
                className="pointer-events-none fixed inset-0 z-0 opacity-20 waw-bg-drift"
                style={{
                    backgroundImage: `url("/images/bacground-waw.svg")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />

            <div className="relative z-10 mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-3xl font-black tracking-tight text-black">Manage users</h1>
                        <p className="mt-1 text-sm font-semibold text-black/55">
                            Staff accounts for the front desk
                        </p>
                    </div>
                    <Link href="/dashboard" className="btn-waw inline-flex self-start">
                        Back to dashboard
                    </Link>
                </div>

                {flash?.success && (
                    <div className="mb-4 rounded-xl border-2 border-black bg-[#FFD400] px-4 py-3 text-sm font-bold text-black">
                        {flash.success}
                    </div>
                )}

                {pageErrors?.user && (
                    <div className="mb-4 rounded-xl border-2 border-black bg-[#FFF5F3] px-4 py-3 text-sm font-bold text-red-600">
                        {pageErrors.user}
                    </div>
                )}

                <div className="mb-5 rounded-2xl border-2 border-black bg-[#FFFDF5] p-5 sm:p-6">
                    <h2 className="mb-4 text-[12px] font-black uppercase tracking-[0.12em] text-black/45">
                        Create staff account
                    </h2>
                    <form onSubmit={submitCreate} className="space-y-4">
                        <div>
                            <label className="mb-1.5 block text-sm font-bold text-black">Username</label>
                            <input
                                type="text"
                                value={createForm.data.username}
                                onChange={(e) => createForm.setData('username', e.target.value)}
                                autoFocus
                                className={field}
                                placeholder="Username"
                            />
                            {createForm.errors.username && (
                                <p className="mt-1 text-sm font-semibold text-red-600">
                                    {createForm.errors.username}
                                </p>
                            )}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-sm font-bold text-black">Password</label>
                                <input
                                    type="password"
                                    value={createForm.data.password}
                                    onChange={(e) => createForm.setData('password', e.target.value)}
                                    className={field}
                                />
                                {createForm.errors.password && (
                                    <p className="mt-1 text-sm font-semibold text-red-600">
                                        {createForm.errors.password}
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-bold text-black">
                                    Confirm password
                                </label>
                                <input
                                    type="password"
                                    value={createForm.data.password_confirmation}
                                    onChange={(e) =>
                                        createForm.setData('password_confirmation', e.target.value)
                                    }
                                    className={field}
                                />
                            </div>
                        </div>

                        <button type="submit" disabled={createForm.processing} className="btn-waw">
                            {createForm.processing ? 'Creating…' : 'Create account'}
                        </button>
                    </form>
                </div>

                <div className="rounded-2xl border-2 border-black bg-[#FFFDF5] p-5 sm:p-6">
                    <h2 className="mb-4 text-[12px] font-black uppercase tracking-[0.12em] text-black/45">
                        Accounts ({users.length})
                    </h2>
                    <div className="space-y-2">
                        {users.map((user) => {
                            const isSelf = user.id === authUserId;
                            const menuKey = `user-${user.id}`;

                            return (
                                <div
                                    key={user.id}
                                    className="flex items-center justify-between gap-3 rounded-xl border-2 border-black bg-white px-4 py-3"
                                >
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="truncate text-sm font-black capitalize text-black">
                                                {user.username}
                                            </p>
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                                                    user.role === 'admin'
                                                        ? 'bg-[#FFD400] text-black ring-1 ring-black'
                                                        : 'bg-black/5 text-black/60 ring-1 ring-black/15'
                                                }`}
                                            >
                                                {user.role}
                                            </span>
                                            {isSelf && (
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-black/40">
                                                    you
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-[11px] font-semibold text-black/40">
                                            Since{' '}
                                            {user.created_at
                                                ? new Date(user.created_at).toLocaleDateString()
                                                : '—'}
                                        </p>
                                    </div>

                                    <div className="relative shrink-0">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setOpenMenu(openMenu === menuKey ? null : menuKey)
                                            }
                                            className="flex h-9 w-9 items-center justify-center rounded-xl border-2 border-black bg-[#FFD400] text-lg font-black text-black"
                                            aria-label="Actions"
                                        >
                                            ⋯
                                        </button>
                                        {openMenu === menuKey && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="fixed inset-0 z-20 cursor-default"
                                                    onClick={() => setOpenMenu(null)}
                                                    aria-label="Close"
                                                />
                                                <div className="absolute right-0 z-30 mt-1 min-w-[9rem] overflow-hidden rounded-xl border-2 border-black bg-[#FFFDF5] py-1 shadow-[3px_3px_0_#000]">
                                                    <button
                                                        type="button"
                                                        onClick={() => openEdit(user)}
                                                        className="block w-full px-3 py-2 text-left text-[13px] font-bold text-black hover:bg-[#FFD400]/50"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => deleteUser(user)}
                                                        disabled={isSelf}
                                                        className="block w-full px-3 py-2 text-left text-[13px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-35"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        {users.length === 0 && (
                            <p className="text-sm font-semibold text-black/45">No users yet.</p>
                        )}
                    </div>
                </div>
            </div>

            {editingUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
                    <div className="w-full max-w-md rounded-2xl border-2 border-black bg-[#FFFDF5] p-6 shadow-[4px_4px_0_#000]">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-lg font-black text-black">Edit account</h2>
                                <p className="text-xs font-semibold text-black/45">
                                    Leave password blank to keep it
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEdit}
                                className="text-lg font-black text-black/40 hover:text-black"
                            >
                                ×
                            </button>
                        </div>

                        <form onSubmit={submitEdit} className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-sm font-bold text-black">Username</label>
                                <input
                                    type="text"
                                    value={editForm.data.username}
                                    onChange={(e) => editForm.setData('username', e.target.value)}
                                    className={field}
                                />
                                {editForm.errors.username && (
                                    <p className="mt-1 text-sm font-semibold text-red-600">
                                        {editForm.errors.username}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-bold text-black">
                                    New password
                                </label>
                                <input
                                    type="password"
                                    value={editForm.data.password}
                                    onChange={(e) => editForm.setData('password', e.target.value)}
                                    className={field}
                                    placeholder="Optional"
                                />
                                {editForm.errors.password && (
                                    <p className="mt-1 text-sm font-semibold text-red-600">
                                        {editForm.errors.password}
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-bold text-black">
                                    Confirm password
                                </label>
                                <input
                                    type="password"
                                    value={editForm.data.password_confirmation}
                                    onChange={(e) =>
                                        editForm.setData('password_confirmation', e.target.value)
                                    }
                                    className={field}
                                    placeholder="Optional"
                                />
                            </div>

                            <div className="flex gap-2 pt-1">
                                <button type="button" onClick={closeEdit} className="btn-waw-ghost flex-1">
                                    Cancel
                                </button>
                                <button type="submit" disabled={editForm.processing} className="btn-waw flex-1">
                                    {editForm.processing ? 'Saving…' : 'Save'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
