// How long a presence row survives without a heartbeat (poll). After this the
// dot is treated as offline and removed — implements "dot disappears when the
// user leaves" even if their tab closed without a clean leave.
export const STALE_MS = 15_000;

// Orphan signals (mailbox messages never drained) are cleaned up after this.
export const SIGNAL_TTL_MS = 60_000;

// Client poll interval. Kept here so client + server reason about the same cadence.
export const POLL_INTERVAL_MS = 1_500;

// Ambient "Ripple" liveness events (joins + connections broadcast to everyone).
// Poll returns ripples from the last RIPPLE_WINDOW_MS; older ones are reaped.
export const RIPPLE_WINDOW_MS = 6_000;
export const RIPPLE_TTL_MS = 12_000;
