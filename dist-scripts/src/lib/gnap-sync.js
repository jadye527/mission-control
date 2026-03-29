"use strict";
/**
 * GNAP Sync Engine — push MC tasks to a Git-Native Agent Protocol repo.
 *
 * SQLite remains the primary store. The GNAP repo is an optional sync target
 * following the same pattern as `github-sync-engine.ts`.
 *
 * Phase 1: MC → GNAP only (push). Pull/bidirectional sync is Phase 2.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcStatusToGnap = mcStatusToGnap;
exports.gnapStatusToMc = gnapStatusToMc;
exports.mcPriorityToGnap = mcPriorityToGnap;
exports.initGnapRepo = initGnapRepo;
exports.pushTaskToGnap = pushTaskToGnap;
exports.removeTaskFromGnap = removeTaskFromGnap;
exports.pullTasksFromGnap = pullTasksFromGnap;
exports.syncGnap = syncGnap;
exports.getGnapStatus = getGnapStatus;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const logger_1 = require("@/lib/logger");
// ── Status / priority mapping ──────────────────────────────────
const MC_TO_GNAP_STATUS = {
    pending: 'backlog',
    inbox: 'backlog',
    assigned: 'ready',
    ready: 'ready',
    in_progress: 'in_progress',
    review: 'review',
    quality_review: 'review',
    completed: 'done',
    done: 'done',
    blocked: 'blocked',
    cancelled: 'cancelled',
};
const GNAP_TO_MC_STATUS = {
    backlog: 'inbox',
    ready: 'assigned',
    in_progress: 'in_progress',
    review: 'review',
    done: 'done',
    blocked: 'blocked',
    cancelled: 'cancelled',
};
const MC_TO_GNAP_PRIORITY = {
    low: 'low',
    medium: 'medium',
    high: 'high',
    critical: 'critical',
    urgent: 'critical',
};
function mcStatusToGnap(status) {
    return MC_TO_GNAP_STATUS[status] || 'backlog';
}
function gnapStatusToMc(state) {
    return GNAP_TO_MC_STATUS[state] || 'inbox';
}
function mcPriorityToGnap(priority) {
    return MC_TO_GNAP_PRIORITY[priority] || 'medium';
}
// ── Git helpers ────────────────────────────────────────────────
function git(repoPath, args) {
    var _a, _b;
    try {
        return (0, node_child_process_1.execFileSync)('git', args, {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 15000,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
    }
    catch (err) {
        const stderr = ((_b = (_a = err.stderr) === null || _a === void 0 ? void 0 : _a.toString) === null || _b === void 0 ? void 0 : _b.call(_a)) || '';
        throw new Error(`git ${args[0]} failed: ${stderr || err.message}`);
    }
}
function hasRemote(repoPath) {
    try {
        const remotes = git(repoPath, ['remote']);
        return remotes.length > 0;
    }
    catch (_a) {
        return false;
    }
}
function hasChanges(repoPath) {
    try {
        const status = git(repoPath, ['status', '--porcelain']);
        return status.length > 0;
    }
    catch (_a) {
        return false;
    }
}
// ── Core functions ─────────────────────────────────────────────
function initGnapRepo(repoPath) {
    node_fs_1.default.mkdirSync(node_path_1.default.join(repoPath, 'tasks'), { recursive: true });
    const versionFile = node_path_1.default.join(repoPath, 'version');
    if (!node_fs_1.default.existsSync(versionFile)) {
        node_fs_1.default.writeFileSync(versionFile, '1\n');
    }
    const agentsFile = node_path_1.default.join(repoPath, 'agents.json');
    if (!node_fs_1.default.existsSync(agentsFile)) {
        node_fs_1.default.writeFileSync(agentsFile, JSON.stringify({ agents: [] }, null, 2) + '\n');
    }
    // Init git if not already a repo
    const gitDir = node_path_1.default.join(repoPath, '.git');
    if (!node_fs_1.default.existsSync(gitDir)) {
        git(repoPath, ['init']);
        git(repoPath, ['add', '.']);
        git(repoPath, ['commit', '-m', 'Initialize GNAP repository']);
    }
    logger_1.logger.info({ repoPath }, 'GNAP repo initialized');
}
function taskToGnapJson(task) {
    var _a;
    const tags = Array.isArray(task.tags)
        ? task.tags
        : (typeof task.tags === 'string' ? JSON.parse(task.tags || '[]') : []);
    return {
        id: `mc-${task.id}`,
        title: task.title,
        description: task.description || '',
        state: mcStatusToGnap(task.status),
        assignee: task.assigned_to || '',
        priority: mcPriorityToGnap(task.priority),
        tags,
        created: task.created_at
            ? new Date(task.created_at * 1000).toISOString()
            : new Date().toISOString(),
        updated: task.updated_at
            ? new Date(task.updated_at * 1000).toISOString()
            : new Date().toISOString(),
        mc_id: task.id,
        mc_project_id: (_a = task.project_id) !== null && _a !== void 0 ? _a : null,
    };
}
function pushTaskToGnap(task, repoPath) {
    const tasksDir = node_path_1.default.join(repoPath, 'tasks');
    node_fs_1.default.mkdirSync(tasksDir, { recursive: true });
    const gnapTask = taskToGnapJson(task);
    const filePath = node_path_1.default.join(tasksDir, `${gnapTask.id}.json`);
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(gnapTask, null, 2) + '\n');
    git(repoPath, ['add', node_path_1.default.relative(repoPath, filePath)]);
    if (hasChanges(repoPath)) {
        git(repoPath, ['commit', '-m', `Update task ${gnapTask.id}: ${task.title}`]);
    }
    if (hasRemote(repoPath)) {
        try {
            git(repoPath, ['push']);
        }
        catch (err) {
            logger_1.logger.warn({ err, repoPath }, 'GNAP push to remote failed (continuing)');
        }
    }
}
function removeTaskFromGnap(taskId, repoPath) {
    const filePath = node_path_1.default.join(repoPath, 'tasks', `mc-${taskId}.json`);
    if (!node_fs_1.default.existsSync(filePath))
        return;
    git(repoPath, ['rm', node_path_1.default.relative(repoPath, filePath)]);
    if (hasChanges(repoPath)) {
        git(repoPath, ['commit', '-m', `Remove task mc-${taskId}`]);
    }
    if (hasRemote(repoPath)) {
        try {
            git(repoPath, ['push']);
        }
        catch (err) {
            logger_1.logger.warn({ err, repoPath }, 'GNAP push to remote failed (continuing)');
        }
    }
}
function pullTasksFromGnap(repoPath) {
    const tasksDir = node_path_1.default.join(repoPath, 'tasks');
    if (!node_fs_1.default.existsSync(tasksDir))
        return [];
    // Pull remote changes first if available
    if (hasRemote(repoPath)) {
        try {
            git(repoPath, ['pull', '--rebase']);
        }
        catch (err) {
            logger_1.logger.warn({ err, repoPath }, 'GNAP pull from remote failed (using local)');
        }
    }
    const files = node_fs_1.default.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
    const tasks = [];
    for (const file of files) {
        try {
            const content = node_fs_1.default.readFileSync(node_path_1.default.join(tasksDir, file), 'utf-8');
            tasks.push(JSON.parse(content));
        }
        catch (err) {
            logger_1.logger.warn({ err, file }, 'Failed to parse GNAP task file');
        }
    }
    return tasks;
}
function syncGnap(repoPath) {
    const result = {
        pushed: 0,
        pulled: 0,
        errors: [],
        lastSync: new Date().toISOString(),
    };
    // Pull remote if available
    if (hasRemote(repoPath)) {
        try {
            git(repoPath, ['pull', '--rebase']);
        }
        catch (err) {
            result.errors.push(`Pull failed: ${err.message}`);
        }
    }
    // Count local tasks
    const tasksDir = node_path_1.default.join(repoPath, 'tasks');
    if (node_fs_1.default.existsSync(tasksDir)) {
        result.pushed = node_fs_1.default.readdirSync(tasksDir).filter(f => f.endsWith('.json')).length;
    }
    // Push if remote available
    if (hasRemote(repoPath) && hasChanges(repoPath)) {
        try {
            git(repoPath, ['add', '.']);
            git(repoPath, ['commit', '-m', `Sync from Mission Control at ${result.lastSync}`]);
            git(repoPath, ['push']);
        }
        catch (err) {
            result.errors.push(`Push failed: ${err.message}`);
        }
    }
    return result;
}
function getGnapStatus(repoPath) {
    const tasksDir = node_path_1.default.join(repoPath, 'tasks');
    const initialized = node_fs_1.default.existsSync(node_path_1.default.join(repoPath, 'version'));
    const taskCount = initialized && node_fs_1.default.existsSync(tasksDir)
        ? node_fs_1.default.readdirSync(tasksDir).filter(f => f.endsWith('.json')).length
        : 0;
    let remote = false;
    let remoteUrl = '';
    if (initialized) {
        try {
            remote = hasRemote(repoPath);
            if (remote) {
                remoteUrl = git(repoPath, ['remote', 'get-url', 'origin']);
            }
        }
        catch ( /* no remote */_a) { /* no remote */ }
    }
    return { initialized, taskCount, hasRemote: remote, remoteUrl };
}
