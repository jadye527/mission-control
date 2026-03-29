"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForbiddenError = void 0;
exports.getWorkspaceForTenant = getWorkspaceForTenant;
exports.listWorkspacesForTenant = listWorkspacesForTenant;
exports.assertWorkspaceTenant = assertWorkspaceTenant;
exports.ensureTenantWorkspaceAccess = ensureTenantWorkspaceAccess;
exports.ensureTenantProjectAccess = ensureTenantProjectAccess;
class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.status = 403;
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
function logTenantAccessDenied(db, targetType, targetId, tenantId, context) {
    var _a, _b, _c;
    db.prepare(`
    INSERT INTO audit_log (action, actor, actor_id, target_type, target_id, detail, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('tenant_access_denied', context.actor || 'unknown', (_a = context.actorId) !== null && _a !== void 0 ? _a : null, targetType, targetId, JSON.stringify({
        tenant_id: tenantId,
        route: context.route || null,
    }), (_b = context.ipAddress) !== null && _b !== void 0 ? _b : null, (_c = context.userAgent) !== null && _c !== void 0 ? _c : null);
}
function getWorkspaceForTenant(db, workspaceId, tenantId) {
    const row = db.prepare(`
    SELECT id, slug, name, tenant_id, created_at, updated_at
    FROM workspaces
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).get(workspaceId, tenantId);
    return row || null;
}
function listWorkspacesForTenant(db, tenantId) {
    return db.prepare(`
    SELECT id, slug, name, tenant_id, created_at, updated_at
    FROM workspaces
    WHERE tenant_id = ?
    ORDER BY CASE WHEN slug = 'default' THEN 0 ELSE 1 END, name COLLATE NOCASE ASC
  `).all(tenantId);
}
function assertWorkspaceTenant(db, workspaceId, tenantId) {
    const workspace = getWorkspaceForTenant(db, workspaceId, tenantId);
    if (!workspace) {
        throw new Error('Workspace not found for tenant');
    }
    return workspace;
}
function ensureTenantWorkspaceAccess(db, tenantId, workspaceId, context = {}) {
    const workspace = getWorkspaceForTenant(db, workspaceId, tenantId);
    if (!workspace) {
        logTenantAccessDenied(db, 'workspace', workspaceId, tenantId, context);
        throw new ForbiddenError('Workspace not accessible for tenant');
    }
    return workspace;
}
function ensureTenantProjectAccess(db, tenantId, projectId, context = {}) {
    const project = db.prepare(`
    SELECT p.id, p.workspace_id, w.tenant_id
    FROM projects p
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE p.id = ?
    LIMIT 1
  `).get(projectId);
    if (!project || project.tenant_id !== tenantId) {
        logTenantAccessDenied(db, 'project', projectId, tenantId, context);
        throw new ForbiddenError('Project not accessible for tenant');
    }
    return project;
}
