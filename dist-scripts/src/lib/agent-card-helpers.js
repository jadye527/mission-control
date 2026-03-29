"use strict";
/**
 * Helpers for agent card display — extracted for testability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatModelName = formatModelName;
exports.buildTaskStatParts = buildTaskStatParts;
exports.extractWsHost = extractWsHost;
/** Strip provider prefix from model ID: "anthropic/claude-opus-4-5" → "claude-opus-4-5" */
function formatModelName(config) {
    var _a;
    const raw = (_a = config === null || config === void 0 ? void 0 : config.model) === null || _a === void 0 ? void 0 : _a.primary;
    const primary = typeof raw === 'string' ? raw : raw === null || raw === void 0 ? void 0 : raw.primary;
    if (!primary || typeof primary !== 'string')
        return null;
    const parts = primary.split('/');
    return parts[parts.length - 1];
}
/** Build inline task stat parts from agent taskStats, omitting zero counts. */
function buildTaskStatParts(stats) {
    if (!stats)
        return null;
    const parts = [];
    if (stats.assigned)
        parts.push({ label: 'assigned', count: stats.assigned });
    if (stats.in_progress)
        parts.push({ label: 'active', count: stats.in_progress, color: 'text-amber-300' });
    if (stats.quality_review)
        parts.push({ label: 'review', count: stats.quality_review, color: 'text-violet-300' });
    if (stats.done)
        parts.push({ label: 'done', count: stats.done, color: 'text-emerald-300' });
    return parts.length > 0 ? parts : null;
}
/** Extract WebSocket host from connection URL for tooltip display. */
function extractWsHost(url) {
    if (!url)
        return '—';
    try {
        return new URL(url.replace(/^ws/, 'http')).host;
    }
    catch (_a) {
        return '—';
    }
}
