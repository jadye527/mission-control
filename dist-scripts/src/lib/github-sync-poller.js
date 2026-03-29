"use strict";
/**
 * Background poller for GitHub ↔ MC task sync.
 * Lazy singleton — call startSyncPoller() to begin.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSyncPoller = startSyncPoller;
exports.stopSyncPoller = stopSyncPoller;
exports.getSyncPollerStatus = getSyncPollerStatus;
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const github_sync_engine_1 = require("@/lib/github-sync-engine");
const INTERVAL_MS = parseInt(process.env.GITHUB_SYNC_INTERVAL_MS || '60000', 10);
let intervalHandle = null;
let lastRun;
function startSyncPoller() {
    if (intervalHandle)
        return;
    logger_1.logger.info({ intervalMs: INTERVAL_MS }, 'Starting GitHub sync poller');
    intervalHandle = setInterval(async () => {
        await runSyncTick();
    }, INTERVAL_MS);
    // Run immediately on start
    runSyncTick().catch(() => { });
}
function stopSyncPoller() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger_1.logger.info('GitHub sync poller stopped');
    }
}
function getSyncPollerStatus() {
    return {
        running: intervalHandle !== null,
        interval: INTERVAL_MS,
        lastRun,
    };
}
async function runSyncTick() {
    try {
        const db = (0, db_1.getDatabase)();
        const projects = db.prepare(`
      SELECT id, github_repo, github_sync_enabled, github_default_branch, workspace_id
      FROM projects
      WHERE github_sync_enabled = 1 AND github_repo IS NOT NULL AND status = 'active'
    `).all();
        for (const project of projects) {
            try {
                await (0, github_sync_engine_1.pullFromGitHub)(project, project.workspace_id);
            }
            catch (err) {
                logger_1.logger.error({ err, projectId: project.id, repo: project.github_repo }, 'Sync poller: project sync failed');
            }
        }
        lastRun = Math.floor(Date.now() / 1000);
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Sync poller tick failed');
    }
}
