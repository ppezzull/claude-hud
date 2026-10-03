export interface EffortInfo {
    level: string;
    symbol: string;
}
/**
 * Resolve the current session's effort level.
 *
 * Priority:
 * 1. stdin.effort (future — when Claude Code exposes it in statusline JSON)
 * 2. Parent process CLI args (reflects --effort flag at session start)
 *
 * Returns null if effort cannot be determined.
 */
export declare function resolveEffortLevel(stdinEffort?: string | null): EffortInfo | null;
//# sourceMappingURL=effort.d.ts.map