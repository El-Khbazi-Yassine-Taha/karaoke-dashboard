import { router } from '@inertiajs/react';

/** Shared Inertia options so desk actions only refresh dashboard props (faster clicks). */
export const DASHBOARD_ONLY = [
    'rooms',
    'summary',
    'serverTime',
    'serverTimestamp',
    'reservations',
    'dailyRevenue',
    'roomRevenues',
    'errors',
    'flash',
];

/** In-flight desk POSTs — background poll must not overwrite their response with stale data. */
let deskMutations = 0;

export function isDeskMutating() {
    return deskMutations > 0;
}

/**
 * Visit options for desk actions. Tracks in-flight mutations so the dashboard
 * poll can skip while checkout / check-in / etc. are running.
 */
export function deskVisitOptions(extra = {}) {
    const { onStart, onFinish, onError, onSuccess, ...rest } = extra;

    return {
        preserveScroll: true,
        preserveState: true,
        only: DASHBOARD_ONLY,
        ...rest,
        onStart: (visit) => {
            deskMutations += 1;
            onStart?.(visit);
        },
        onSuccess: (page) => {
            onSuccess?.(page);
        },
        onError: (errors) => {
            onError?.(errors);
        },
        onFinish: (visit) => {
            deskMutations = Math.max(0, deskMutations - 1);
            onFinish?.(visit);
        },
    };
}

/** Alias — always call as deskVisit() or deskVisit({ onSuccess }). */
export function deskVisit(extra = {}) {
    return deskVisitOptions(extra);
}

/** POST and abort any in-flight poll so stale room state cannot win the race. */
export function deskPost(url, data = {}, extra = {}) {
    try {
        router.cancelAll({ prefetch: true });
    } catch (_) {
        /* ignore */
    }
    router.post(url, data, deskVisitOptions(extra));
}
