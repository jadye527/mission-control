"use strict";
/**
 * Bidirectional mapping between Mission Control statuses/priorities and GitHub labels.
 * Labels use `mc:` prefix to avoid collisions with existing repo labels.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PRIORITY_LABEL_NAMES = exports.ALL_STATUS_LABEL_NAMES = exports.ALL_MC_LABELS = void 0;
exports.statusToLabel = statusToLabel;
exports.labelToStatus = labelToStatus;
exports.priorityToLabel = priorityToLabel;
exports.labelToPriority = labelToPriority;
// ── Status ↔ Label mapping ──────────────────────────────────────
const STATUS_LABEL_MAP = {
    inbox: { name: 'mc:inbox', color: '6b7280', description: 'Mission Control: inbox' },
    assigned: { name: 'mc:assigned', color: '3b82f6', description: 'Mission Control: assigned' },
    in_progress: { name: 'mc:in-progress', color: 'eab308', description: 'Mission Control: in progress' },
    review: { name: 'mc:review', color: 'a855f7', description: 'Mission Control: review' },
    quality_review: { name: 'mc:quality-review', color: '6366f1', description: 'Mission Control: quality review' },
    awaiting_owner: { name: 'mc:awaiting-owner', color: 'f59e0b', description: 'Mission Control: awaiting owner' },
    done: { name: 'mc:done', color: '22c55e', description: 'Mission Control: done' },
};
const LABEL_STATUS_MAP = Object.fromEntries(Object.entries(STATUS_LABEL_MAP).map(([status, def]) => [def.name, status]));
function statusToLabel(status) {
    return STATUS_LABEL_MAP[status];
}
function labelToStatus(labelName) {
    var _a;
    return (_a = LABEL_STATUS_MAP[labelName]) !== null && _a !== void 0 ? _a : null;
}
// ── Priority ↔ Label mapping ───────────────────────────────────
const PRIORITY_LABEL_MAP = {
    critical: { name: 'priority:critical', color: 'ef4444', description: 'Priority: critical' },
    high: { name: 'priority:high', color: 'f97316', description: 'Priority: high' },
    medium: { name: 'priority:medium', color: 'eab308', description: 'Priority: medium' },
    low: { name: 'priority:low', color: '22c55e', description: 'Priority: low' },
};
const LABEL_PRIORITY_MAP = Object.fromEntries(Object.entries(PRIORITY_LABEL_MAP).map(([priority, def]) => [def.name, priority]));
function priorityToLabel(priority) {
    var _a;
    return (_a = PRIORITY_LABEL_MAP[priority]) !== null && _a !== void 0 ? _a : PRIORITY_LABEL_MAP.medium;
}
function labelToPriority(labels) {
    for (const label of labels) {
        const p = LABEL_PRIORITY_MAP[label];
        if (p)
            return p;
    }
    return 'medium';
}
// ── All MC labels (for initialization) ──────────────────────────
exports.ALL_MC_LABELS = [
    ...Object.values(STATUS_LABEL_MAP),
    ...Object.values(PRIORITY_LABEL_MAP),
];
exports.ALL_STATUS_LABEL_NAMES = Object.values(STATUS_LABEL_MAP).map(l => l.name);
exports.ALL_PRIORITY_LABEL_NAMES = Object.values(PRIORITY_LABEL_MAP).map(l => l.name);
