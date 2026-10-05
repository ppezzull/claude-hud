#!/usr/bin/env bun
/**
 * glm-wrapper.ts — GLM Usage Wrapper for claude-hud
 *
 * Sits between Claude Code and the claude-hud statusline plugin. It reads the
 * JSON that Claude Code pipes in, injects Zhipu AI (GLM Coding Plan) quota
 * data from the monitoring API, then hands everything to claude-hud for
 * rendering — so the HUD shows real GLM token usage percentages.
 *
 * Behavior:
 *   - Quota data is cached at ~/.cache/zhipu-usage.json (60s TTL).
 *   - Expired cache is refreshed in the background (non-blocking).
 *   - On a cold start (no usable cache) it fetches synchronously so the Usage
 *     line is present on the very first statusline render.
 *   - If the quota API is unreachable, stale cached data is used rather than
 *     dropping the Usage line entirely.
 *
 * Based on hxuaj/glm-claude-hud, with the following improvements:
 *   1. Quota endpoint auto-detect — derives the monitor URL from
 *      ANTHROPIC_BASE_URL (works with api.z.ai), falls back to open.bigmodel.cn.
 *   2. Robust bun resolution — checks well-known absolute paths first, so the
 *      statusline still works in environments with a minimal PATH (Warp, GUI
 *      launchers, cron...).
 *   3. claude-hud entry — prefers src/index.ts, falls back to dist/index.js.
 *   4. Cold-start sync fetch + stale-cache fallback (see Behavior above).
 *
 * Debug: set GLM_HUD_DEBUG=1 to append diagnostics to
 * ~/.cache/zhipu-hud-debug.log.
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, statSync, appendFileSync } from "node:fs";
import { spawn, execSync, execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const CACHE_PATH = join(homedir(), ".cache", "zhipu-usage.json");
const CACHE_TTL = 60_000; // 60 seconds
const DEBUG_LOG = join(homedir(), ".cache", "zhipu-hud-debug.log");

function debug(msg: string) {
  if (process.env.GLM_HUD_DEBUG !== "1") return;
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} [pid=${process.pid}] ${msg}\n`);
  } catch {}
}

function ensureCacheDir() {
  const dir = dirname(CACHE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Build the monitor quota URL from the configured Anthropic base URL, with a fallback. */
function quotaEndpoints(): string[] {
  const base = (process.env.ANTHROPIC_BASE_URL || "").trim();
  const urls: string[] = [];
  if (base) {
    // api.z.ai/api/anthropic      -> api.z.ai/api/monitor/usage/quota/limit
    // open.bigmodel.cn/api/anthropic -> open.bigmodel.cn/api/monitor/usage/quota/limit
    const root = base.replace(/\/anthropic\/?$/, "").replace(/\/$/, "");
    if (root) urls.push(`${root}/api/monitor/usage/quota/limit`);
  }
  urls.push("https://open.bigmodel.cn/api/monitor/usage/quota/limit");
  // de-dup, preserve order
  return Array.from(new Set(urls));
}

function refreshCacheBackground() {
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!token) return;
  ensureCacheDir();
  try {
    const child = spawn(
      "bash",
      [
        "-c",
        quotaEndpoints()
          .map(
            (url) =>
              `curl -sf --max-time 5 -H "Authorization: ${token}" "${url}" -o "${CACHE_PATH}" && grep -q '"code":200' "${CACHE_PATH}" && exit 0`
          )
          .join(" || ") + " || true",
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
  } catch {}
}

function readCache(): any[] | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const raw = readFileSync(CACHE_PATH, "utf8");
    const resp = JSON.parse(raw);
    // Use stale cache as fallback rather than dropping it — a failed/slow
    // background refresh should never blank out the GLM usage line entirely.
    if (resp.code === 200 && resp.data?.limits) return resp.data.limits;
  } catch {}
  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    let done = false;
    const finish = () => {
      if (!done) { done = true; resolve(data); }
    };
    const timer = setTimeout(finish, 250);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c: string) => { data += c; });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

function findClaudeHudDir(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const base = join(configDir, "plugins/cache/claude-hud/claude-hud");
  try {
    if (!existsSync(base)) return "";
    const versions = readdirSync(base)
      .filter((name) => {
        const p = join(base, name);
        return statSync(p).isDirectory() && /^\d+\.\d+\.\d+$/.test(name);
      })
      .sort((a, b) => {
        const pa = a.split(".").map(Number);
        const pb = b.split(".").map(Number);
        for (let i = 0; i < 3; i++) {
          if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
        }
        return 0;
      });
    if (versions.length === 0) return "";
    return join(base, versions[versions.length - 1]) + "/";
  } catch { return ""; }
}

/**
 * Resolve the bun binary. Well-known absolute paths are checked first because
 * the statusline may run in environments with a minimal PATH (e.g. Warp or
 * other GUI-launched terminals) where `bun` is not on PATH.
 */
function findBun(): string {
  const candidates = [
    join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    return execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
  } catch {
    return "bun";
  }
}

(async () => {
  const raw = (await readStdin()).trim();
  if (!raw) return;

  let stdin: any;
  try { stdin = JSON.parse(raw); } catch { return; }

  // Refresh cache in background when expired (non-blocking)
  try {
    if (!existsSync(CACHE_PATH) || Date.now() - statSync(CACHE_PATH).mtimeMs > CACHE_TTL) {
      refreshCacheBackground();
    }
  } catch {}

  // If there is no usable cached data (e.g. first render of a session),
  // fetch synchronously so the Usage line shows immediately instead of
  // appearing only after the background refresh lands (~60s later).
  if (!readCache()) {
    debug("cold start: no usable cache, fetching synchronously");
    const token = process.env.ANTHROPIC_AUTH_TOKEN;
    if (token) {
      ensureCacheDir();
      for (const url of quotaEndpoints()) {
        try {
          execSync(
            `curl -sf --max-time 3 -H "Authorization: ${token}" "${url}" -o "${CACHE_PATH}"`,
            { timeout: 4000 }
          );
          if (readCache()) { debug(`sync fetch ok via ${url}`); break; }
        } catch (e: any) { debug(`sync fetch failed via ${url}: ${e?.message ?? e}`); }
      }
    }
  }

  // Inject Zhipu API quota data
  // The API returns 3 quota types:
  //   TOKENS_LIMIT (unit=3, number=5) -> 5-hour rolling window, resets in ~hours
  //   TOKENS_LIMIT (unit=6, number=1) -> weekly, resets in ~7 days
  //   TIME_LIMIT   (unit=5, number=1) -> monthly, resets in ~30 days (not displayed)
  const limits = readCache();
  if (limits) {
    const fiveHour = limits.find(
      (l: any) => l.type === "TOKENS_LIMIT" && l.unit === 3 && l.number === 5
    );
    const weekly = limits.find(
      (l: any) => l.type === "TOKENS_LIMIT" && l.unit === 6 && l.number === 1
    );

    stdin.rate_limits = {};
    if (fiveHour) {
      stdin.rate_limits.five_hour = {
        used_percentage: fiveHour.percentage,
        resets_at: Math.floor(fiveHour.nextResetTime / 1000),
      };
    }
    if (weekly) {
      stdin.rate_limits.seven_day = {
        used_percentage: weekly.percentage,
        resets_at: Math.floor(weekly.nextResetTime / 1000),
      };
    }
  }

  // Find and run claude-hud
  const pluginDir = findClaudeHudDir();
  if (!pluginDir) return;

  // Entry point: prefer bun-runnable TS source, fall back to compiled bundle.
  const tsEntry = join(pluginDir, "src/index.ts");
  const jsEntry = join(pluginDir, "dist/index.js");
  const entry = existsSync(tsEntry) ? tsEntry : existsSync(jsEntry) ? jsEntry : "";
  if (!entry) return;

  // Set COLUMNS so claude-hud detects terminal width correctly
  const childEnv = { ...(process.env as Record<string, string>) };
  if (!childEnv.COLUMNS) {
    try {
      childEnv.COLUMNS = execSync("tput cols 2>/dev/null", {
        encoding: "utf8", timeout: 1000,
      }).trim() || "200";
    } catch { childEnv.COLUMNS = "200"; }
  }

  const child = spawn(
    findBun(),
    ["--env-file", "/dev/null", entry],
    { env: childEnv, stdio: ["pipe", "pipe", "pipe"] }
  );

  const timeout = setTimeout(() => { child.kill(); }, 3000);

  child.stdin.write(JSON.stringify(stdin));
  child.stdin.end();

  let output = "";
  child.stdout.on("data", (c: Buffer) => { output += c.toString(); });
  child.stdout.on("end", () => {
    clearTimeout(timeout);
    if (output) process.stdout.write(output);
  });
  child.on("error", () => { clearTimeout(timeout); });
})();
