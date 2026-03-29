"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const config_1 = require("@/lib/config");
const logger_1 = require("@/lib/logger");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
function getCronFilePath() {
    const openclawStateDir = config_1.config.openclawStateDir;
    if (!openclawStateDir)
        return '';
    return node_path_1.default.join(openclawStateDir, 'cron', 'jobs.json');
}
async function loadCronFile() {
    const filePath = getCronFilePath();
    if (!filePath)
        return null;
    try {
        const raw = await (0, promises_1.readFile)(filePath, 'utf-8');
        return JSON.parse(raw);
    }
    catch (_a) {
        return null;
    }
}
async function saveCronFile(data) {
    const filePath = getCronFilePath();
    if (!filePath)
        return false;
    try {
        await (0, promises_1.writeFile)(filePath, JSON.stringify(data, null, 2));
        return true;
    }
    catch (err) {
        logger_1.logger.error({ err }, 'Failed to write cron file');
        return false;
    }
}
function mapLastStatus(status) {
    if (!status)
        return undefined;
    const s = status.toLowerCase();
    if (s === 'success' || s === 'completed' || s === 'updated')
        return 'success';
    if (s === 'error' || s === 'failed')
        return 'error';
    if (s === 'running' || s === 'pending')
        return 'running';
    return 'success'; // default for unknown non-error statuses
}
function mapOpenClawJob(job) {
    var _a, _b, _c, _d, _e, _f;
    // Build a human-readable command description from the payload
    const payloadSummary = job.payload.message
        ? job.payload.message.slice(0, 200) + (job.payload.message.length > 200 ? '...' : '')
        : `${job.payload.kind} (${job.agentId})`;
    const scheduleStr = job.schedule.tz
        ? `${job.schedule.expr} (${job.schedule.tz})`
        : job.schedule.expr;
    return {
        id: job.id,
        name: job.name,
        schedule: scheduleStr,
        command: payloadSummary,
        enabled: job.enabled,
        lastRun: (_a = job.state) === null || _a === void 0 ? void 0 : _a.lastRunAtMs,
        nextRun: (_b = job.state) === null || _b === void 0 ? void 0 : _b.nextRunAtMs,
        lastStatus: mapLastStatus((_c = job.state) === null || _c === void 0 ? void 0 : _c.lastStatus),
        lastError: (_d = job.state) === null || _d === void 0 ? void 0 : _d.lastError,
        agentId: job.agentId,
        timezone: job.schedule.tz,
        model: job.payload.model,
        delivery: ((_e = job.delivery) === null || _e === void 0 ? void 0 : _e.mode) === 'none' ? undefined : (_f = job.delivery) === null || _f === void 0 ? void 0 : _f.channel,
    };
}
async function GET(request) {
    var _a;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        if (action === 'list') {
            const cronFile = await loadCronFile();
            if (!cronFile || !cronFile.jobs) {
                return server_1.NextResponse.json({ jobs: [] });
            }
            const jobs = cronFile.jobs.map(mapOpenClawJob);
            return server_1.NextResponse.json({ jobs });
        }
        if (action === 'logs') {
            const jobId = searchParams.get('job');
            if (!jobId) {
                return server_1.NextResponse.json({ error: 'Job ID required' }, { status: 400 });
            }
            // Find the job to get its state info
            const cronFile = await loadCronFile();
            const job = cronFile === null || cronFile === void 0 ? void 0 : cronFile.jobs.find(j => j.id === jobId || j.name === jobId);
            const logs = [];
            if (job === null || job === void 0 ? void 0 : job.state) {
                if (job.state.lastRunAtMs) {
                    logs.push({
                        timestamp: job.state.lastRunAtMs,
                        message: `Job executed — status: ${job.state.lastStatus || 'unknown'}${job.state.lastDurationMs ? ` (${job.state.lastDurationMs}ms)` : ''}`,
                        level: job.state.lastStatus === 'error' || job.state.lastStatus === 'failed' ? 'error' : 'info',
                    });
                }
                if (job.state.lastError) {
                    logs.push({
                        timestamp: job.state.lastRunAtMs || Date.now(),
                        message: `Error: ${job.state.lastError}`,
                        level: 'error',
                    });
                }
                if (job.state.nextRunAtMs) {
                    logs.push({
                        timestamp: Date.now(),
                        message: `Next scheduled run: ${new Date(job.state.nextRunAtMs).toLocaleString()}`,
                        level: 'info',
                    });
                }
            }
            return server_1.NextResponse.json({ logs });
        }
        if (action === 'history') {
            const jobId = searchParams.get('jobId');
            if (!jobId) {
                return server_1.NextResponse.json({ error: 'Job ID required' }, { status: 400 });
            }
            const page = parseInt(searchParams.get('page') || '1', 10);
            const query = searchParams.get('query') || '';
            // Try to load run history from the cron runs log file
            const openclawStateDir = config_1.config.openclawStateDir;
            if (!openclawStateDir) {
                return server_1.NextResponse.json({ entries: [], total: 0, hasMore: false });
            }
            try {
                const runsPath = node_path_1.default.join(openclawStateDir, 'cron', 'runs.json');
                const raw = await (0, promises_1.readFile)(runsPath, 'utf-8');
                const runsData = JSON.parse(raw);
                let entries = Array.isArray(runsData.runs) ? runsData.runs : Array.isArray(runsData) ? runsData : [];
                // Filter to this job
                entries = entries.filter((r) => r.jobId === jobId || r.id === jobId);
                // Apply search filter
                if (query) {
                    const q = query.toLowerCase();
                    entries = entries.filter((r) => (r.status || '').toLowerCase().includes(q) ||
                        (r.error || '').toLowerCase().includes(q) ||
                        (r.deliveryStatus || '').toLowerCase().includes(q));
                }
                // Sort by timestamp descending
                entries.sort((a, b) => (b.timestamp || b.startedAtMs || 0) - (a.timestamp || a.startedAtMs || 0));
                const pageSize = 20;
                const start = (page - 1) * pageSize;
                const paged = entries.slice(start, start + pageSize);
                return server_1.NextResponse.json({
                    entries: paged,
                    total: entries.length,
                    hasMore: start + pageSize < entries.length,
                    page,
                });
            }
            catch (_b) {
                // No runs file — fall back to state-based info
                const cronFile = await loadCronFile();
                const job = cronFile === null || cronFile === void 0 ? void 0 : cronFile.jobs.find(j => j.id === jobId || j.name === jobId);
                const entries = [];
                if ((_a = job === null || job === void 0 ? void 0 : job.state) === null || _a === void 0 ? void 0 : _a.lastRunAtMs) {
                    entries.push({
                        jobId: job.id,
                        status: job.state.lastStatus || 'unknown',
                        timestamp: job.state.lastRunAtMs,
                        durationMs: job.state.lastDurationMs,
                        error: job.state.lastError,
                    });
                }
                return server_1.NextResponse.json({ entries, total: entries.length, hasMore: false, page: 1 });
            }
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Cron API error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function POST(request) {
    var _a, _b;
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const { action, jobName, jobId } = body;
        if (action === 'toggle') {
            const id = jobId || jobName;
            if (!id) {
                return server_1.NextResponse.json({ error: 'Job ID or name required' }, { status: 400 });
            }
            const cronFile = await loadCronFile();
            if (!cronFile) {
                return server_1.NextResponse.json({ error: 'Cron file not found' }, { status: 404 });
            }
            const job = cronFile.jobs.find(j => j.id === id || j.name === id);
            if (!job) {
                return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
            }
            job.enabled = !job.enabled;
            job.updatedAtMs = Date.now();
            if (!(await saveCronFile(cronFile))) {
                return server_1.NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 });
            }
            return server_1.NextResponse.json({ success: true, enabled: job.enabled });
        }
        if (action === 'trigger') {
            const id = jobId || jobName;
            if (!id) {
                return server_1.NextResponse.json({ error: 'Job ID required' }, { status: 400 });
            }
            if (process.env.MISSION_CONTROL_ALLOW_COMMAND_TRIGGER !== '1') {
                return server_1.NextResponse.json({ error: 'Manual triggers disabled. Set MISSION_CONTROL_ALLOW_COMMAND_TRIGGER=1 to enable.' }, { status: 403 });
            }
            const cronFile = await loadCronFile();
            const job = cronFile === null || cronFile === void 0 ? void 0 : cronFile.jobs.find(j => j.id === id || j.name === id);
            if (!job) {
                return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
            }
            // For OpenClaw cron jobs, trigger via the openclaw CLI
            const triggerMode = body.mode || 'force';
            const { runCommand } = await Promise.resolve().then(() => __importStar(require('@/lib/command')));
            try {
                const args = ['cron', 'trigger', job.id];
                if (triggerMode === 'due') {
                    args.push('--if-due');
                }
                const { stdout, stderr } = await runCommand(config_1.config.openclawBin, args, { timeoutMs: 30000 });
                return server_1.NextResponse.json({
                    success: true,
                    stdout: stdout.trim(),
                    stderr: stderr.trim()
                });
            }
            catch (execError) {
                return server_1.NextResponse.json({
                    success: false,
                    error: execError.message,
                    stdout: ((_a = execError.stdout) === null || _a === void 0 ? void 0 : _a.trim()) || '',
                    stderr: ((_b = execError.stderr) === null || _b === void 0 ? void 0 : _b.trim()) || ''
                }, { status: 500 });
            }
        }
        if (action === 'remove') {
            const id = jobId || jobName;
            if (!id) {
                return server_1.NextResponse.json({ error: 'Job ID or name required' }, { status: 400 });
            }
            const cronFile = await loadCronFile();
            if (!cronFile) {
                return server_1.NextResponse.json({ error: 'Cron file not found' }, { status: 404 });
            }
            const idx = cronFile.jobs.findIndex(j => j.id === id || j.name === id);
            if (idx === -1) {
                return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
            }
            cronFile.jobs.splice(idx, 1);
            if (!(await saveCronFile(cronFile))) {
                return server_1.NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 });
            }
            return server_1.NextResponse.json({ success: true });
        }
        if (action === 'add') {
            const { schedule, command, model, description, staggerSeconds } = body;
            const name = jobName || body.name;
            if (!schedule || !command || !name) {
                return server_1.NextResponse.json({ error: 'Schedule, command, and name required' }, { status: 400 });
            }
            const cronFile = (await loadCronFile()) || { version: 1, jobs: [] };
            // Prevent duplicates: remove existing jobs with the same name
            cronFile.jobs = cronFile.jobs.filter(j => j.name !== name);
            const newJob = {
                id: `mc-${Date.now().toString(36)}`,
                agentId: String(process.env.MC_CRON_AGENT_ID || process.env.MC_COORDINATOR_AGENT || 'system'),
                name,
                enabled: true,
                createdAtMs: Date.now(),
                updatedAtMs: Date.now(),
                schedule: Object.assign({ kind: 'cron', expr: schedule }, (typeof staggerSeconds === 'number' && staggerSeconds > 0
                    ? { staggerMs: staggerSeconds * 1000 }
                    : {})),
                payload: Object.assign({ kind: 'agentTurn', message: command }, (typeof model === 'string' && model.trim() ? { model: model.trim() } : {})),
                delivery: {
                    mode: 'none',
                },
                state: {},
            };
            cronFile.jobs.push(newJob);
            if (!(await saveCronFile(cronFile))) {
                return server_1.NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 });
            }
            return server_1.NextResponse.json({ success: true });
        }
        if (action === 'clone') {
            const id = jobId || jobName;
            if (!id) {
                return server_1.NextResponse.json({ error: 'Job ID required' }, { status: 400 });
            }
            const cronFile = await loadCronFile();
            if (!cronFile) {
                return server_1.NextResponse.json({ error: 'Cron file not found' }, { status: 404 });
            }
            const sourceJob = cronFile.jobs.find(j => j.id === id || j.name === id);
            if (!sourceJob) {
                return server_1.NextResponse.json({ error: 'Job not found' }, { status: 404 });
            }
            // Generate unique clone name
            const existingNames = new Set(cronFile.jobs.map(j => j.name.toLowerCase()));
            let cloneName = `${sourceJob.name} (copy)`;
            let counter = 2;
            while (existingNames.has(cloneName.toLowerCase())) {
                cloneName = `${sourceJob.name} (copy ${counter})`;
                counter++;
            }
            const clonedJob = Object.assign(Object.assign({}, JSON.parse(JSON.stringify(sourceJob))), { id: `mc-${Date.now().toString(36)}`, name: cloneName, createdAtMs: Date.now(), updatedAtMs: Date.now(), state: {} });
            cronFile.jobs.push(clonedJob);
            if (!(await saveCronFile(cronFile))) {
                return server_1.NextResponse.json({ error: 'Failed to save cron file' }, { status: 500 });
            }
            return server_1.NextResponse.json({ success: true, clonedName: cloneName });
        }
        return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Cron management error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
