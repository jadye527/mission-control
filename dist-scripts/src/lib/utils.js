"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cn = cn;
exports.formatUptime = formatUptime;
exports.formatAge = formatAge;
exports.parseTokenUsage = parseTokenUsage;
exports.getStatusColor = getStatusColor;
exports.getStatusBadgeColor = getStatusBadgeColor;
exports.normalizeModel = normalizeModel;
exports.sessionToAgent = sessionToAgent;
exports.generateNodePosition = generateNodePosition;
const clsx_1 = require("clsx");
const tailwind_merge_1 = require("tailwind-merge");
function cn(...inputs) {
    return (0, tailwind_merge_1.twMerge)((0, clsx_1.clsx)(inputs));
}
function formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0)
        return `${days}d ${hours % 24}h`;
    if (hours > 0)
        return `${hours}h ${minutes % 60}m`;
    if (minutes > 0)
        return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}
function formatAge(ageStr) {
    // Convert age strings like "1h ago", "just now" to consistent format
    if (ageStr === 'just now')
        return '< 1m';
    if (ageStr.includes('ago')) {
        return ageStr.replace(' ago', '');
    }
    return ageStr;
}
function parseTokenUsage(tokens) {
    // Parse token strings like "28k/35k (80%)"
    const match = tokens.match(/(\d+)k?\/(\d+)k?\s*\((\d+)%\)/);
    if (!match)
        return { used: 0, total: 0, percentage: 0 };
    const used = parseInt(match[1]) * (match[1].includes('k') ? 1000 : 1);
    const total = parseInt(match[2]) * (match[2].includes('k') ? 1000 : 1);
    const percentage = parseInt(match[3]);
    return { used, total, percentage };
}
function getStatusColor(status) {
    switch (status) {
        case 'active': return 'text-green-500';
        case 'idle': return 'text-yellow-500';
        case 'error': return 'text-red-500';
        case 'offline': return 'text-gray-500';
        default: return 'text-gray-500';
    }
}
function getStatusBadgeColor(status) {
    switch (status) {
        case 'active': return 'bg-green-500/20 text-green-400 border-green-500/30';
        case 'idle': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
        case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30';
        case 'offline': return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
}
/** Normalize model field — OpenClaw 2026.3.x may send {primary: "model-name"} instead of a string */
function normalizeModel(model) {
    if (typeof model === 'string')
        return model;
    if (model && typeof model === 'object' && 'primary' in model)
        return String(model.primary);
    return '';
}
function sessionToAgent(session) {
    const getStatusFromSession = (session) => {
        if (session.age === 'just now' || session.age.includes('m ago'))
            return 'active';
        if (session.age.includes('h ago'))
            return 'idle';
        return 'offline';
    };
    return {
        id: session.id,
        name: session.key.split(':').pop() || session.key,
        type: session.kind === 'direct' ?
            (session.key.includes('subag') ? 'subagent' :
                session.key.includes('cron') ? 'cron' : 'main') : 'group',
        status: getStatusFromSession(session),
        model: session.model,
        session
    };
}
function generateNodePosition(index, total) {
    const angle = (index / total) * 2 * Math.PI;
    const radius = Math.min(300, 50 + total * 10);
    return {
        x: 400 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius
    };
}
