/**
 * Restore checkpoints for this dashboard UI:
 * - "restore" / "restore 1" → pre-WAW-brand redesign (cream corporate)
 * - "restore 2" → this file's companion UI (WAW yellow/black staff tool with ring timer,
 *   Mark paid one-tap, actionable +5m, amber→red end-of-session ring)
 *
 * When the user says "restore 2", revert UI to the design captured after the
 * Jul 29 2026 polish pass (SessionRingTimer time-based colors, RoomColumn Mark paid
 * visible, +5m button-style, light staff surfaces).
 */
export const RESTORE_CHECKPOINT = 2;
export const RESTORE_LABEL = 'WAW staff dashboard — post-polish (restore 2)';
