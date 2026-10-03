import type { StdinData } from "./types.js";
export type ContextCacheDeps = {
    homeDir: () => string;
    now: () => number;
    random: () => number;
};
/**
 * Apply context-window fallback in-place:
 * - For suspicious zero frames, try restoring from the session-scoped cache.
 * - For healthy frames, refresh the cache snapshot for this session
 *   (subject to TTL + value-change throttling to avoid hot-path writes).
 *
 * No-op when stdin has no transcript_path, since without a stable session key
 * we cannot safely isolate cache entries across concurrent Claude Code sessions.
 */
export declare function applyContextWindowFallback(stdin: StdinData, overrides?: Partial<ContextCacheDeps>, sessionName?: string): void;
/**
 * Test-only entrypoint for deterministically exercising the sweep logic.
 */
export declare function _sweepCacheForTests(homeDir: string, now: number): void;
//# sourceMappingURL=context-cache.d.ts.map