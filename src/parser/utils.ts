// Strip ANSI escape codes (color codes from RTT backends)
// eslint-disable-next-line no-control-regex
export const ANSI_RE = /\x1b\[[0-9;]*m/g;
