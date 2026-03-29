"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubSyncSchema = exports.connectSchema = exports.accessRequestActionSchema = exports.createUserSchema = exports.spawnAgentSchema = exports.qualityReviewSchema = exports.gatewayConfigUpdateSchema = exports.updateSettingsSchema = exports.createMessageSchema = exports.createCommentSchema = exports.createWorkflowSchema = exports.createPipelineSchema = exports.integrationActionSchema = exports.notificationActionSchema = exports.createAlertSchema = exports.createWebhookSchema = exports.bulkUpdateTaskStatusSchema = exports.createAgentSchema = exports.updateTaskSchema = exports.createTaskSchema = void 0;
exports.validateBody = validateBody;
const server_1 = require("next/server");
const zod_1 = require("zod");
const zod_2 = require("zod");
async function validateBody(request, schema) {
    try {
        const body = await request.json();
        const data = schema.parse(body);
        return { data };
    }
    catch (err) {
        if (err instanceof zod_1.ZodError) {
            const messages = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
            return {
                error: server_1.NextResponse.json({ error: 'Validation failed', details: messages }, { status: 400 }),
            };
        }
        return {
            error: server_1.NextResponse.json({ error: 'Invalid request body' }, { status: 400 }),
        };
    }
}
const taskMetadataSchema = zod_2.z.object({
    implementation_repo: zod_2.z.string().min(1, 'implementation_repo cannot be empty').max(200).optional(),
    code_location: zod_2.z.string().min(1, 'code_location cannot be empty').max(500).optional(),
}).catchall(zod_2.z.unknown());
exports.createTaskSchema = zod_2.z.object({
    title: zod_2.z.string().min(1, 'Title is required').max(500),
    description: zod_2.z.string().max(5000).optional(),
    status: zod_2.z.enum(['inbox', 'assigned', 'in_progress', 'review', 'quality_review', 'awaiting_owner', 'done']).default('inbox'),
    priority: zod_2.z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    project_id: zod_2.z.number().int().positive().optional(),
    assigned_to: zod_2.z.string().max(100).optional(),
    created_by: zod_2.z.string().max(100).optional(),
    due_date: zod_2.z.number().int().min(0).max(4102444800).optional(), // max ~2100-01-01
    estimated_hours: zod_2.z.number().min(0).max(10000).optional(),
    actual_hours: zod_2.z.number().min(0).max(10000).optional(),
    outcome: zod_2.z.enum(['success', 'failed', 'partial', 'abandoned']).optional(),
    error_message: zod_2.z.string().max(5000).optional(),
    resolution: zod_2.z.string().max(5000).optional(),
    feedback_rating: zod_2.z.number().int().min(1).max(5).optional(),
    feedback_notes: zod_2.z.string().max(5000).optional(),
    retry_count: zod_2.z.number().int().min(0).optional(),
    completed_at: zod_2.z.number().int().min(0).max(4102444800).optional(),
    tags: zod_2.z.array(zod_2.z.string().min(1).max(100)).max(50).default([]),
    metadata: taskMetadataSchema.default({}),
});
exports.updateTaskSchema = exports.createTaskSchema.partial();
exports.createAgentSchema = zod_2.z.object({
    name: zod_2.z.string().min(1, 'Name is required').max(100),
    openclaw_id: zod_2.z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'openclaw_id must be kebab-case').max(100).optional(),
    role: zod_2.z.string().min(1, 'Role is required').max(100).optional(),
    session_key: zod_2.z.string().max(200).optional(),
    soul_content: zod_2.z.string().max(50000).optional(),
    status: zod_2.z.enum(['online', 'offline', 'busy', 'idle', 'error']).default('offline'),
    config: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()).default({}),
    template: zod_2.z.string().max(100).optional(),
    gateway_config: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()).optional(),
    write_to_gateway: zod_2.z.boolean().optional(),
    provision_openclaw_workspace: zod_2.z.boolean().optional(),
    openclaw_workspace_path: zod_2.z.string().min(1).max(500).optional(),
});
exports.bulkUpdateTaskStatusSchema = zod_2.z.object({
    tasks: zod_2.z.array(zod_2.z.object({
        id: zod_2.z.number().int().positive(),
        status: zod_2.z.enum(['inbox', 'assigned', 'in_progress', 'review', 'quality_review', 'awaiting_owner', 'done']),
    })).min(1, 'At least one task is required').max(100),
});
exports.createWebhookSchema = zod_2.z.object({
    name: zod_2.z.string().min(1, 'Name is required').max(200),
    url: zod_2.z.string().url('Invalid URL'),
    events: zod_2.z.array(zod_2.z.string().min(1).max(200)).max(50).optional(),
    generate_secret: zod_2.z.boolean().optional(),
});
exports.createAlertSchema = zod_2.z.object({
    name: zod_2.z.string().min(1, 'Name is required').max(200),
    description: zod_2.z.string().max(1000).optional(),
    entity_type: zod_2.z.enum(['agent', 'task', 'session', 'activity']),
    condition_field: zod_2.z.string().min(1).max(100),
    condition_operator: zod_2.z.enum(['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'count_above', 'count_below', 'age_minutes_above']),
    condition_value: zod_2.z.string().min(1).max(500),
    action_type: zod_2.z.string().max(100).optional(),
    action_config: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()).optional(),
    cooldown_minutes: zod_2.z.number().min(1).max(10080).optional(),
});
exports.notificationActionSchema = zod_2.z.object({
    action: zod_2.z.literal('mark-delivered'),
    agent: zod_2.z.string().min(1, 'Agent name is required'),
});
exports.integrationActionSchema = zod_2.z.object({
    action: zod_2.z.enum(['test', 'pull', 'pull-all']),
    integrationId: zod_2.z.string().optional(),
    category: zod_2.z.string().optional(),
});
exports.createPipelineSchema = zod_2.z.object({
    name: zod_2.z.string().min(1, 'Name is required').max(200),
    description: zod_2.z.string().max(5000).optional(),
    steps: zod_2.z.array(zod_2.z.object({
        template_id: zod_2.z.number().int().positive(),
        on_failure: zod_2.z.enum(['stop', 'continue']).default('stop'),
    })).min(2, 'Pipeline needs at least 2 steps').max(50),
});
exports.createWorkflowSchema = zod_2.z.object({
    name: zod_2.z.string().min(1, 'Name is required').max(200),
    task_prompt: zod_2.z.string().min(1, 'Task prompt is required').max(10000),
    description: zod_2.z.string().max(5000).optional(),
    model: zod_2.z.string().max(100).default('sonnet'),
    timeout_seconds: zod_2.z.number().int().min(10).max(3600).default(300),
    agent_role: zod_2.z.string().max(100).optional(),
    tags: zod_2.z.array(zod_2.z.string().min(1).max(100)).max(50).default([]),
});
exports.createCommentSchema = zod_2.z.object({
    task_id: zod_2.z.number().optional(),
    content: zod_2.z.string().min(1, 'Comment content is required'),
    author: zod_2.z.string().optional(),
    parent_id: zod_2.z.number().optional(),
});
exports.createMessageSchema = zod_2.z.object({
    to: zod_2.z.string().min(1, 'Recipient is required'),
    message: zod_2.z.string().min(1, 'Message is required'),
    from: zod_2.z.string().optional().default('system'),
});
exports.updateSettingsSchema = zod_2.z.object({
    settings: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()),
});
exports.gatewayConfigUpdateSchema = zod_2.z.object({
    updates: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()),
    hash: zod_2.z.string().optional(),
});
exports.qualityReviewSchema = zod_2.z.object({
    taskId: zod_2.z.number(),
    reviewer: zod_2.z.string().default('aegis'),
    status: zod_2.z.enum(['approved', 'rejected']),
    notes: zod_2.z.string().min(1, 'Notes are required for quality reviews'),
});
exports.spawnAgentSchema = zod_2.z.object({
    task: zod_2.z.string().min(1, 'Task is required'),
    model: zod_2.z.string().min(1, 'Model is required').optional(),
    label: zod_2.z.string().min(1, 'Label is required'),
    timeoutSeconds: zod_2.z.number().min(10).max(3600).default(300),
});
exports.createUserSchema = zod_2.z.object({
    username: zod_2.z.string().min(1, 'Username is required'),
    password: zod_2.z.string().min(12, 'Password must be at least 12 characters'),
    display_name: zod_2.z.string().optional(),
    role: zod_2.z.enum(['admin', 'operator', 'viewer']).default('operator'),
    provider: zod_2.z.enum(['local', 'google']).default('local'),
    email: zod_2.z.string().optional(),
});
exports.accessRequestActionSchema = zod_2.z.object({
    request_id: zod_2.z.number(),
    action: zod_2.z.enum(['approve', 'reject']),
    role: zod_2.z.enum(['admin', 'operator', 'viewer']).default('viewer'),
    note: zod_2.z.string().optional(),
});
exports.connectSchema = zod_2.z.object({
    tool_name: zod_2.z.string().min(1, 'Tool name is required').max(100),
    tool_version: zod_2.z.string().max(50).optional(),
    agent_name: zod_2.z.string().min(1, 'Agent name is required').max(100),
    agent_role: zod_2.z.string().max(100).optional(),
    metadata: zod_2.z.record(zod_2.z.string(), zod_2.z.unknown()).optional(),
});
exports.githubSyncSchema = zod_2.z.object({
    action: zod_2.z.enum(['sync', 'comment', 'close', 'status', 'init-labels', 'sync-project']),
    repo: zod_2.z.string().regex(/^[^/]+\/[^/]+$/, 'Repo must be owner/repo format').optional(),
    labels: zod_2.z.string().optional(),
    state: zod_2.z.enum(['open', 'closed', 'all']).optional(),
    assignAgent: zod_2.z.string().optional(),
    issueNumber: zod_2.z.number().optional(),
    body: zod_2.z.string().optional(),
    comment: zod_2.z.string().optional(),
    project_id: zod_2.z.number().optional(),
});
