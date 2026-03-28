const MENTION_PATTERN = /(^|[^A-Za-z0-9._-])@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/g;
function normalizeAgentHandle(name) {
    return name.trim().toLowerCase().replace(/\s+/g, '-');
}
export function parseMentions(text) {
    if (!text || typeof text !== 'string')
        return [];
    const found = [];
    const seen = new Set();
    let match;
    while ((match = MENTION_PATTERN.exec(text)) !== null) {
        const token = String(match[2] || '').trim();
        if (!token)
            continue;
        const key = token.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        found.push(token);
    }
    return found;
}
export function getMentionTargets(db, workspaceId) {
    var _a;
    const targets = [];
    const seenHandles = new Set();
    const users = db.prepare(`
    SELECT username, display_name
    FROM users
    WHERE workspace_id = ?
    ORDER BY username ASC
  `).all(workspaceId);
    for (const user of users) {
        const username = String(user.username || '').trim();
        if (!username)
            continue;
        const handle = username.toLowerCase();
        if (seenHandles.has(handle))
            continue;
        seenHandles.add(handle);
        targets.push({
            handle,
            recipient: username,
            type: 'user',
            display: ((_a = user.display_name) === null || _a === void 0 ? void 0 : _a.trim()) || username,
        });
    }
    const agents = db.prepare(`
    SELECT name, role, config
    FROM agents
    WHERE workspace_id = ?
    ORDER BY name ASC
  `).all(workspaceId);
    for (const agent of agents) {
        const recipient = String(agent.name || '').trim();
        if (!recipient)
            continue;
        let openclawId = null;
        try {
            const parsed = agent.config ? JSON.parse(agent.config) : null;
            if (parsed && typeof parsed.openclawId === 'string' && parsed.openclawId.trim()) {
                openclawId = parsed.openclawId.trim();
            }
        }
        catch (_b) {
            // ignore invalid config JSON for mention indexing
        }
        const candidateHandles = [openclawId, normalizeAgentHandle(recipient), recipient.toLowerCase()]
            .filter((value) => Boolean(value));
        for (const rawHandle of candidateHandles) {
            const handle = rawHandle.toLowerCase();
            if (!handle || seenHandles.has(handle))
                continue;
            seenHandles.add(handle);
            targets.push({
                handle,
                recipient,
                type: 'agent',
                display: recipient,
                role: agent.role || undefined,
            });
        }
    }
    return targets;
}
export function resolveMentionRecipients(text, db, workspaceId) {
    const tokens = parseMentions(text);
    if (tokens.length === 0) {
        return { tokens: [], unresolved: [], recipients: [], resolved: [] };
    }
    const targets = getMentionTargets(db, workspaceId);
    const byHandle = new Map();
    for (const target of targets) {
        byHandle.set(target.handle.toLowerCase(), target);
    }
    const resolved = [];
    const unresolved = [];
    const recipientSeen = new Set();
    for (const token of tokens) {
        const key = token.toLowerCase();
        const target = byHandle.get(key);
        if (!target) {
            unresolved.push(token);
            continue;
        }
        if (!recipientSeen.has(target.recipient)) {
            recipientSeen.add(target.recipient);
            resolved.push(target);
        }
    }
    return {
        tokens,
        unresolved,
        recipients: resolved.map((item) => item.recipient),
        resolved,
    };
}
