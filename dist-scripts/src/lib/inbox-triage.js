/**
 * Inbox Triage — calls Obsidian to review and route inbox tasks.
 *
 * Only fires when there are tasks in inbox status (zero LLM cost when empty).
 * Uses openclaw CLI directly (not gateway WebSocket).
 */
import { getDatabase } from './db';
import { runCommand } from './command';
import { logger } from './logger';
const OPENCLAW_BIN = '/home/jasondye/.nvm/versions/node/v22.22.0/bin/openclaw';
export async function runInboxTriage() {
    try {
        const db = getDatabase();
        // Check if there are any inbox tasks
        const inboxTasks = db.prepare(`
      SELECT id, title, priority, assigned_to, created_at
      FROM tasks
      WHERE status = 'inbox'
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
        created_at ASC
      LIMIT 10
    `).all();
        if (inboxTasks.length === 0) {
            return { ok: true, message: 'Inbox empty — no triage needed' };
        }
        // Build triage prompt with task list
        const taskList = inboxTasks.map(t => `- [${t.id}] "${t.title}" (priority: ${t.priority}, assigned: ${t.assigned_to || 'none'})`).join('\n');
        const prompt = `You have ${inboxTasks.length} task(s) in the MC inbox that need triage.

For each task, decide:
1. Assign to the right agent (ralph=dev, sentinel=trading, obsidian=strategy/content)
2. Set appropriate priority if not already set
3. Move from inbox to assigned

Use mc-report task-update <id> assigned to assign tasks.

Inbox tasks:
${taskList}

Triage these tasks now. Be concise.`;
        logger.info({ count: inboxTasks.length }, 'Running inbox triage');
        const { stdout, stderr, code } = await runCommand(OPENCLAW_BIN, [
            'agent',
            '--agent', 'obsidian',
            '--message', prompt,
            '--timeout', '120',
        ], { timeoutMs: 130000 });
        if (code !== 0 && code !== null) {
            logger.warn({ code, stderr: stderr.substring(0, 200) }, 'Inbox triage exited with non-zero code');
        }
        const response = stdout.substring(0, 500) || '(no output)';
        return { ok: true, message: `Triaged ${inboxTasks.length} inbox task(s): ${response.substring(0, 200)}` };
    }
    catch (err) {
        logger.error({ err }, 'Inbox triage failed');
        return { ok: false, message: `Inbox triage failed: ${err.message}` };
    }
}
