/**
 * Display phones cleanly: +212 688162935 (no trunk 0 after country code).
 */
export function formatPhoneDisplay(raw) {
    if (raw == null || raw === '') return '—';
    const text = String(raw).trim();
    if (!text || text === '—') return '—';

    const digits = text.replace(/\D/g, '');
    if (!digits) return text;

    // Morocco (+212): drop leading 0 after country code
    if (digits.startsWith('212')) {
        let national = digits.slice(3);
        if (national.startsWith('0')) national = national.replace(/^0+/, '');
        return national ? `+212 ${national}` : '+212';
    }

    // Local Moroccan mobile typed as 06… / 07…
    if (digits.startsWith('0') && (digits.length === 9 || digits.length === 10)) {
        const national = digits.replace(/^0+/, '');
        return `+212 ${national}`;
    }

    // Generic international: +CC0national → +CC national
    if (text.startsWith('+')) {
        const match = text.match(/^\+(\d{1,3})0+(\d+)$/);
        if (match) return `+${match[1]} ${match[2]}`;
        const spaced = text.match(/^\+(\d{1,3})(\d+)$/);
        if (spaced) return `+${spaced[1]} ${spaced[2]}`;
    }

    return text;
}
