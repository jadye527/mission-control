"use strict";
/**
 * Hermes Cron/Task Scanner
 *
 * Read-only bridge that discovers Hermes Agent's scheduled cron jobs from:
 * - ~/.hermes/cron/jobs.json — Scheduled task definitions
 * - ~/.hermes/cron/output/{job_id}/ — Execution output files
 *
 * Follows the same throttled-scan pattern as claude-tasks.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHermesTasks = getHermesTasks;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const config_1 = require("./config");
const logger_1 = require("./logger");
function getHermesCronDir() {
    return (0, node_path_1.join)(config_1.config.homeDir, '.hermes', 'cron');
}
function peekLatestOutput(cronDir, jobId) {
    const outputDir = (0, node_path_1.join)(cronDir, 'output', jobId);
    try {
        if (!(0, node_fs_1.existsSync)(outputDir) || !(0, node_fs_1.statSync)(outputDir).isDirectory()) {
            return { lastRunAt: null, lastOutput: null };
        }
        const files = (0, node_fs_1.readdirSync)(outputDir)
            .filter(f => f.endsWith('.md'))
            .sort()
            .reverse();
        if (files.length === 0)
            return { lastRunAt: null, lastOutput: null };
        const latestFile = files[0];
        // Filename is typically a timestamp like 2025-01-15T10-30-00.md
        const timestamp = latestFile.replace(/\.md$/, '').replace(/-/g, (m, i) => {
            // Convert filename back to ISO-ish timestamp
            return i > 9 ? ':' : m;
        });
        const filePath = (0, node_path_1.join)(outputDir, latestFile);
        let content = null;
        try {
            const raw = (0, node_fs_1.readFileSync)(filePath, 'utf-8');
            content = raw.slice(0, 500);
        }
        catch ( /* ignore */_a) { /* ignore */ }
        return {
            lastRunAt: timestamp || null,
            lastOutput: content,
        };
    }
    catch (_b) {
        return { lastRunAt: null, lastOutput: null };
    }
}
function scanCronJobs() {
    const cronDir = getHermesCronDir();
    const jobsFile = (0, node_path_1.join)(cronDir, 'jobs.json');
    if (!(0, node_fs_1.existsSync)(jobsFile))
        return [];
    try {
        const raw = (0, node_fs_1.readFileSync)(jobsFile, 'utf-8');
        const jobs = JSON.parse(raw);
        if (!Array.isArray(jobs))
            return [];
        return jobs.map((job) => {
            const id = job.id || job.name || 'unknown';
            const { lastRunAt, lastOutput } = peekLatestOutput(cronDir, id);
            return {
                id,
                prompt: job.prompt || job.command || job.description || '',
                schedule: job.schedule || job.cron || job.interval || '',
                enabled: job.enabled !== false,
                lastRunAt: job.last_run_at || lastRunAt,
                lastOutput,
                createdAt: job.created_at || null,
            };
        });
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Failed to parse Hermes cron jobs');
        return [];
    }
}
// Throttle full disk scans
let lastScanAt = 0;
let cachedResult = { cronJobs: [] };
const SCAN_THROTTLE_MS = 30000;
function getHermesTasks(force = false) {
    const now = Date.now();
    if (!force && lastScanAt > 0 && (now - lastScanAt) < SCAN_THROTTLE_MS) {
        return cachedResult;
    }
    try {
        cachedResult = { cronJobs: scanCronJobs() };
        lastScanAt = now;
    }
    catch (err) {
        logger_1.logger.warn({ err }, 'Hermes task scan failed');
    }
    return cachedResult;
}
