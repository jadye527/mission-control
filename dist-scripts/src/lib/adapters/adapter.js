"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryPendingAssignments = queryPendingAssignments;
const db_1 = require("@/lib/db");
function queryPendingAssignments(agentId) {
    try {
        const db = (0, db_1.getDatabase)();
        const rows = db.prepare(`
      SELECT id, title, description, priority
      FROM tasks
      WHERE (assigned_to = ? OR assigned_to IS NULL)
        AND status IN ('assigned', 'inbox')
      ORDER BY
        CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
        due_date ASC,
        created_at ASC
      LIMIT 5
    `).all(agentId);
        return rows.map(row => ({
            taskId: String(row.id),
            description: row.title + (row.description ? `\n${row.description}` : ''),
            priority: row.priority === 'critical' ? 0 : row.priority === 'high' ? 1 : row.priority === 'medium' ? 2 : 3,
        }));
    }
    catch (_a) {
        return [];
    }
}
