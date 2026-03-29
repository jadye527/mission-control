"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateStats = calculateStats;
exports.buildTaskCostReport = buildTaskCostReport;
function calculateStats(records) {
    if (records.length === 0) {
        return {
            totalTokens: 0,
            totalCost: 0,
            requestCount: 0,
            avgTokensPerRequest: 0,
            avgCostPerRequest: 0,
        };
    }
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const requestCount = records.length;
    return {
        totalTokens,
        totalCost,
        requestCount,
        avgTokensPerRequest: Math.round(totalTokens / requestCount),
        avgCostPerRequest: totalCost / requestCount,
    };
}
function groupByModel(records) {
    const modelGroups = {};
    for (const record of records) {
        if (!modelGroups[record.model])
            modelGroups[record.model] = [];
        modelGroups[record.model].push(record);
    }
    const result = {};
    for (const [model, modelRecords] of Object.entries(modelGroups)) {
        result[model] = calculateStats(modelRecords);
    }
    return result;
}
function buildTimeline(records) {
    const byDate = {};
    for (const record of records) {
        const date = new Date(record.timestamp).toISOString().split('T')[0];
        if (!byDate[date]) {
            byDate[date] = { cost: 0, tokens: 0 };
        }
        byDate[date].cost += record.cost;
        byDate[date].tokens += record.totalTokens;
    }
    return Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, totals]) => (Object.assign({ date }, totals)));
}
function formatTicketRef(prefix, num) {
    if (!prefix || typeof num !== 'number' || !Number.isFinite(num) || num <= 0)
        return null;
    return `${prefix}-${String(num).padStart(3, '0')}`;
}
function buildTaskCostReport(records, taskMetadata) {
    const attributedRecords = records.filter((record) => Number.isFinite(record.taskId));
    const unattributedRecords = records.filter((record) => !Number.isFinite(record.taskId));
    const byTask = {};
    for (const record of attributedRecords) {
        const taskId = Number(record.taskId);
        if (!taskMetadata[taskId])
            continue;
        if (!byTask[taskId])
            byTask[taskId] = [];
        byTask[taskId].push(record);
    }
    const tasks = Object.entries(byTask)
        .map(([taskIdRaw, taskRecords]) => {
        var _a, _b, _c;
        const taskId = Number(taskIdRaw);
        const meta = taskMetadata[taskId];
        return {
            taskId,
            title: meta.title,
            status: meta.status,
            priority: meta.priority,
            assignedTo: meta.assigned_to || null,
            project: {
                id: (_a = meta.project_id) !== null && _a !== void 0 ? _a : null,
                name: (_b = meta.project_name) !== null && _b !== void 0 ? _b : null,
                slug: (_c = meta.project_slug) !== null && _c !== void 0 ? _c : null,
                ticketRef: formatTicketRef(meta.project_prefix, meta.project_ticket_no),
            },
            stats: calculateStats(taskRecords),
            models: groupByModel(taskRecords),
            timeline: buildTimeline(taskRecords),
        };
    })
        .sort((a, b) => b.stats.totalCost - a.stats.totalCost);
    const byAgent = {};
    for (const record of attributedRecords) {
        const taskId = Number(record.taskId);
        if (!taskMetadata[taskId])
            continue;
        if (!byAgent[record.agentName])
            byAgent[record.agentName] = [];
        byAgent[record.agentName].push(record);
    }
    const agentTaskIds = {};
    for (const task of tasks) {
        const taskRecords = byTask[task.taskId] || [];
        for (const record of taskRecords) {
            const agent = record.agentName;
            if (!agentTaskIds[agent])
                agentTaskIds[agent] = new Set();
            agentTaskIds[agent].add(task.taskId);
        }
    }
    const agents = {};
    for (const [agent, agentRecords] of Object.entries(byAgent)) {
        const taskIds = [...(agentTaskIds[agent] || new Set())].sort((a, b) => a - b);
        agents[agent] = {
            stats: calculateStats(agentRecords),
            taskCount: taskIds.length,
            taskIds,
        };
    }
    const byProject = {};
    const projectTaskIds = {};
    for (const record of attributedRecords) {
        const taskId = Number(record.taskId);
        const meta = taskMetadata[taskId];
        if (!meta)
            continue;
        const key = meta.project_id ? String(meta.project_id) : 'unscoped';
        if (!byProject[key])
            byProject[key] = [];
        byProject[key].push(record);
        if (!projectTaskIds[key])
            projectTaskIds[key] = new Set();
        projectTaskIds[key].add(taskId);
    }
    const projects = {};
    for (const [projectKey, projectRecords] of Object.entries(byProject)) {
        const taskIds = [...(projectTaskIds[projectKey] || new Set())].sort((a, b) => a - b);
        projects[projectKey] = {
            stats: calculateStats(projectRecords),
            taskCount: taskIds.length,
            taskIds,
        };
    }
    return {
        summary: calculateStats(attributedRecords.filter((record) => Number.isFinite(record.taskId) && taskMetadata[Number(record.taskId)])),
        tasks,
        agents,
        projects,
        unattributed: calculateStats(unattributedRecords),
    };
}
