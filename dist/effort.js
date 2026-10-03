import { execFileSync } from 'node:child_process';
const KNOWN_SYMBOLS = {
    low: '○',
    medium: '◔',
    high: '◑',
    xhigh: '◕',
    max: '●',
};
/**
 * Resolve the current session's effort level.
 *
 * Priority:
 * 1. stdin.effort (future — when Claude Code exposes it in statusline JSON)
 * 2. Parent process CLI args (reflects --effort flag at session start)
 *
 * Returns null if effort cannot be determined.
 */
export function resolveEffortLevel(stdinEffort) {
    if (stdinEffort) {
        return formatEffort(stdinEffort);
    }
    const cliEffort = readParentProcessEffort();
    if (cliEffort) {
        return formatEffort(cliEffort);
    }
    return null;
}
function formatEffort(level) {
    const normalized = level.toLowerCase().trim();
    const symbol = KNOWN_SYMBOLS[normalized] ?? '';
    return { level: normalized, symbol };
}
function readParentProcessEffort() {
    if (process.platform === 'win32') {
        return null;
    }
    try {
        const ppid = process.ppid;
        if (!ppid || ppid <= 1) {
            return null;
        }
        const output = execFileSync('ps', ['-o', 'args=', '-p', String(ppid)], {
            encoding: 'utf8',
            timeout: 500,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const match = output.match(/--effort[= ]+(\w+)/);
        return match?.[1] ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=effort.js.map