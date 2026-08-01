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

export const deskVisit = {
    preserveScroll: true,
    preserveState: true,
    only: DASHBOARD_ONLY,
};
