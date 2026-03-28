/**
 * Provider Cooldown Manager
 *
 * When the gateway hits a quota/billing limit on a model provider, the error
 * often includes a "retry after" hint (e.g. "Try again in ~665 min"). The
 * gateway's built-in cooldown caps at 1 hour for rate_limit errors, which is
 * too short for day-long quota exhaustion.
 *
 * This module parses quota errors from dispatch failures and writes
 * `disabledUntil` directly to each agent's auth-profiles.json. The gateway
 * reads these files on every profile selection and will skip disabled
 * providers entirely — no process spawning, no wasted cycles.
 *
 * Created 2026-03-18 after a retry storm (97 dispatches in 6 hours) caused
 * by OpenAI's "Try again in ~665 min" being treated as a 1-hour transient.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger';
const OPENCLAW_AGENTS_DIR = join(process.env.HOME || '/home/jasondye', '.openclaw', 'agents');
// ---------------------------------------------------------------------------
// claude-cli watchdog timeout tracking
// ---------------------------------------------------------------------------
// The gateway's auth-profile cooldown system only tracks API providers.
// claude-cli failures are watchdog kills (no output after 60s) — no parseable
// error message means the quota cooldown path never fires.
//
// Fix: track consecutive cli timeouts in a state file. After CLI_TIMEOUT_THRESHOLD
// consecutive timeouts, write `disabledUntil` into every agent's auth-profiles.json
// under a synthetic "claude-cli:default" profile key. The gateway reads this key
// during profile selection and skips the cli backend for the cooldown window.
const CLI_TIMEOUT_THRESHOLD = 2; // disable after this many consecutive timeouts
const CLI_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const CLI_STATE_FILE = join(process.env.HOME || '/home/jasondye', '.openclaw', 'cli-timeout-state.json');
function readCliState() {
    try {
        if (existsSync(CLI_STATE_FILE)) {
            return JSON.parse(readFileSync(CLI_STATE_FILE, 'utf-8'));
        }
    }
    catch ( /* ignore */_a) { /* ignore */ }
    return { consecutiveTimeouts: 0, lastTimeoutAt: 0 };
}
function writeCliState(state) {
    try {
        writeFileSync(CLI_STATE_FILE, JSON.stringify(state, null, 2) + '\n');
    }
    catch (err) {
        logger.error({ err }, 'Failed to write cli-timeout-state.json');
    }
}
function disableCliAcrossAgents(disabledUntilMs) {
    const { readdirSync } = require('node:fs');
    let agentDirs;
    try {
        agentDirs = readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
    catch (err) {
        logger.error({ err }, 'Failed to list agent directories for cli cooldown');
        return;
    }
    for (const agentDir of agentDirs) {
        // Try both auth-profiles.json locations (some agents have /agent/ subdir)
        const candidates = [
            join(OPENCLAW_AGENTS_DIR, agentDir, 'agent', 'auth-profiles.json'),
            join(OPENCLAW_AGENTS_DIR, agentDir, 'auth-profiles.json'),
        ];
        const filePath = candidates.find(existsSync);
        if (!filePath)
            continue;
        try {
            const store = JSON.parse(readFileSync(filePath, 'utf-8'));
            if (!store.profiles)
                store.profiles = {};
            if (!store.usageStats)
                store.usageStats = {};
            // Ensure a synthetic claude-cli:default profile exists
            if (!store.profiles['claude-cli:default']) {
                store.profiles['claude-cli:default'] = { type: 'cli', provider: 'claude-cli' };
            }
            const stats = store.usageStats['claude-cli:default'] || {};
            if (stats.disabledUntil && stats.disabledUntil >= disabledUntilMs)
                continue;
            stats.disabledUntil = disabledUntilMs;
            stats.disabledReason = 'watchdog_timeout';
            stats.errorCount = (stats.errorCount || 0) + 1;
            stats.lastFailureAt = Date.now();
            store.usageStats['claude-cli:default'] = stats;
            writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n');
            logger.info({ agentDir }, 'claude-cli disabled in auth-profiles due to repeated watchdog timeouts');
        }
        catch (err) {
            logger.error({ err, agentDir }, 'Failed to disable claude-cli in auth-profiles');
        }
    }
}
/**
 * Call this from task-dispatch when a dispatch error contains a cli watchdog timeout.
 * Tracks consecutive timeouts and disables claude-cli after CLI_TIMEOUT_THRESHOLD hits.
 */
export function handleCliWatchdogTimeout(error) {
    if (!error.includes('watchdog timeout') && !error.includes('noOutputTimeout') && !error.includes('cli exec'))
        return;
    const state = readCliState();
    const now = Date.now();
    // Reset counter if last timeout was more than 10 minutes ago (not a storm)
    if (now - state.lastTimeoutAt > 10 * 60 * 1000) {
        state.consecutiveTimeouts = 0;
    }
    state.consecutiveTimeouts += 1;
    state.lastTimeoutAt = now;
    logger.warn({ consecutiveTimeouts: state.consecutiveTimeouts, threshold: CLI_TIMEOUT_THRESHOLD }, 'claude-cli watchdog timeout recorded');
    if (state.consecutiveTimeouts >= CLI_TIMEOUT_THRESHOLD) {
        const disabledUntilMs = now + CLI_COOLDOWN_MS;
        state.disabledUntil = disabledUntilMs;
        state.consecutiveTimeouts = 0; // reset after triggering cooldown
        logger.warn({ disabledUntil: new Date(disabledUntilMs).toISOString(), cooldownHours: CLI_COOLDOWN_MS / 3600000 }, `claude-cli disabled for ${CLI_COOLDOWN_MS / 3600000}h after ${CLI_TIMEOUT_THRESHOLD} consecutive watchdog timeouts`);
        disableCliAcrossAgents(disabledUntilMs);
    }
    writeCliState(state);
}
// Cap: never disable a provider for more than 24 hours
const MAX_DISABLE_MS = 24 * 60 * 60 * 1000;
// Default disable duration when we detect quota exhaustion but can't parse a hint
const DEFAULT_DISABLE_MS = 2 * 60 * 60 * 1000; // 2 hours
// Minimum: don't bother for anything under 5 minutes (that's a transient rate limit)
const MIN_DISABLE_MS = 5 * 60 * 1000;
/**
 * Patterns that indicate quota/billing exhaustion (not a transient 429).
 * Order matters: first match wins for extraction.
 */
const QUOTA_PATTERNS = [
    // OpenAI: "You have hit your ChatGPT usage limit (plus plan). Try again in ~665 min."
    { re: /usage limit/i },
    // OpenAI: "Try again in ~NNN min"
    { re: /try again in ~?(\d+)\s*min/i, extractMinutes: true },
    // Generic quota
    { re: /quota exceeded/i },
    // Billing
    { re: /billing.*(?:error|limit|exceeded)/i },
    { re: /exceeded.*plan/i },
    // Anthropic: "Your account has insufficient credits"
    { re: /insufficient credits/i },
];
/**
 * Analyze an error message to determine if it indicates quota exhaustion
 * and how long to wait.
 */
export function parseQuotaError(error) {
    if (!error)
        return { isQuotaExhaustion: false, retryAfterMs: null, provider: null };
    let isQuota = false;
    let retryAfterMs = null;
    for (const { re, extractMinutes } of QUOTA_PATTERNS) {
        const match = error.match(re);
        if (match) {
            isQuota = true;
            if (extractMinutes && match[1]) {
                const minutes = parseInt(match[1], 10);
                if (minutes > 0 && minutes <= 1440) {
                    retryAfterMs = Math.min(minutes * 60000, MAX_DISABLE_MS);
                }
            }
            break;
        }
    }
    // Also check for "retry-after: NNN" header-style hints (seconds)
    if (!retryAfterMs) {
        const secMatch = error.match(/retry[- ]?after[:\s]+(\d+)/i);
        if (secMatch) {
            const seconds = parseInt(secMatch[1], 10);
            if (seconds > 300) { // > 5 min = likely quota, not transient
                retryAfterMs = Math.min(seconds * 1000, MAX_DISABLE_MS);
                isQuota = true;
            }
        }
    }
    // Try to identify the provider from the error
    let provider = null;
    if (/chatgpt|openai|gpt-/i.test(error))
        provider = 'openai-codex';
    else if (/anthropic|claude/i.test(error))
        provider = 'anthropic';
    else if (/google|gemini/i.test(error))
        provider = 'google';
    else if (/openrouter/i.test(error))
        provider = 'openrouter';
    return { isQuotaExhaustion: isQuota, retryAfterMs, provider };
}
/**
 * Resolve which profile IDs to disable for a given provider.
 * Reads the auth-profiles.json to find profiles matching the provider.
 */
function findProfilesForProvider(profiles, provider) {
    return Object.entries(profiles)
        .filter(([key, val]) => {
        // Match by key prefix (e.g. "openai-codex:chatgpt" starts with "openai-codex")
        if (key.startsWith(provider + ':'))
            return true;
        // Match by provider field in profile
        if ((val === null || val === void 0 ? void 0 : val.provider) === provider)
            return true;
        return false;
    })
        .map(([key]) => key);
}
/**
 * Disable a provider across all agent auth-profiles.json files.
 * Sets `disabledUntil` so the gateway skips this provider entirely.
 */
export function disableProviderUntil(provider, disabledUntilMs, reason = 'rate_limit') {
    const agentsUpdated = [];
    const profilesDisabled = [];
    let agentDirs;
    try {
        const { readdirSync } = require('node:fs');
        agentDirs = readdirSync(OPENCLAW_AGENTS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
    }
    catch (err) {
        logger.error({ err, dir: OPENCLAW_AGENTS_DIR }, 'Failed to list agent directories');
        return { agentsUpdated, profilesDisabled };
    }
    for (const agentDir of agentDirs) {
        const filePath = join(OPENCLAW_AGENTS_DIR, agentDir, 'auth-profiles.json');
        if (!existsSync(filePath)) {
            // Agent has no auth-profiles.json yet — skip (gateway will create one
            // on first use). We can only disable providers in files that exist.
            logger.info({ agentDir }, 'No auth-profiles.json — skipping (gateway will create on first use)');
            continue;
        }
        try {
            const store = JSON.parse(readFileSync(filePath, 'utf-8'));
            const profiles = store.profiles || {};
            const matchingProfiles = findProfilesForProvider(profiles, provider);
            if (matchingProfiles.length === 0)
                continue;
            // Ensure usageStats exists
            if (!store.usageStats)
                store.usageStats = {};
            let updated = false;
            for (const profileId of matchingProfiles) {
                const stats = store.usageStats[profileId] || {};
                // Only update if the new disabled time is later than any existing one
                if (stats.disabledUntil && stats.disabledUntil >= disabledUntilMs) {
                    logger.info({ agentDir, profileId, existingUntil: new Date(stats.disabledUntil).toISOString() }, 'Provider already disabled until later — skipping');
                    continue;
                }
                stats.disabledUntil = disabledUntilMs;
                stats.disabledReason = reason;
                stats.errorCount = (stats.errorCount || 0) + 1;
                if (!stats.failureCounts)
                    stats.failureCounts = {};
                stats.failureCounts[reason] = (stats.failureCounts[reason] || 0) + 1;
                stats.lastFailureAt = Date.now();
                store.usageStats[profileId] = stats;
                updated = true;
                profilesDisabled.push(`${agentDir}/${profileId}`);
            }
            if (updated) {
                writeFileSync(filePath, JSON.stringify(store, null, 2) + '\n');
                agentsUpdated.push(agentDir);
            }
        }
        catch (err) {
            logger.error({ err, agentDir, filePath }, 'Failed to update auth-profiles.json');
        }
    }
    return { agentsUpdated, profilesDisabled };
}
/**
 * Main entry point: called from task-dispatch when a dispatch fails.
 * Analyzes the error and disables the offending provider if it's a quota issue.
 */
export function handleDispatchQuotaError(error) {
    const quota = parseQuotaError(error);
    if (!quota.isQuotaExhaustion)
        return;
    const disableDurationMs = quota.retryAfterMs
        ? Math.max(quota.retryAfterMs, MIN_DISABLE_MS)
        : DEFAULT_DISABLE_MS;
    const disabledUntilMs = Date.now() + disableDurationMs;
    const disabledUntilStr = new Date(disabledUntilMs).toISOString();
    const durationMinutes = Math.round(disableDurationMs / 60000);
    if (!quota.provider) {
        logger.warn({ error: error.substring(0, 200), durationMinutes }, 'Quota exhaustion detected but could not identify provider — cannot disable');
        return;
    }
    logger.warn({
        provider: quota.provider,
        disabledUntil: disabledUntilStr,
        durationMinutes,
        retryAfterHintMs: quota.retryAfterMs,
        errorPreview: error.substring(0, 200),
    }, `Quota exhaustion: disabling provider "${quota.provider}" until ${disabledUntilStr} (${durationMinutes} min)`);
    const result = disableProviderUntil(quota.provider, disabledUntilMs, 'billing');
    logger.info({
        provider: quota.provider,
        agentsUpdated: result.agentsUpdated,
        profilesDisabled: result.profilesDisabled,
        disabledUntil: disabledUntilStr,
    }, `Provider "${quota.provider}" disabled across ${result.agentsUpdated.length} agents (${result.profilesDisabled.length} profiles)`);
}
