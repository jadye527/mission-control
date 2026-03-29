"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTaskCreateStatus = normalizeTaskCreateStatus;
exports.normalizeTaskUpdateStatus = normalizeTaskUpdateStatus;
function hasAssignee(assignedTo) {
    return Boolean(assignedTo && assignedTo.trim());
}
/**
 * Keep task state coherent when a task is created with an assignee.
 * If caller asks for `inbox` but also sets `assigned_to`, normalize to `assigned`.
 */
function normalizeTaskCreateStatus(requestedStatus, assignedTo) {
    const status = requestedStatus !== null && requestedStatus !== void 0 ? requestedStatus : 'inbox';
    if (status === 'inbox' && hasAssignee(assignedTo))
        return 'assigned';
    return status;
}
/**
 * Auto-adjust status for assignment-only updates when caller does not
 * explicitly request a status transition.
 */
function normalizeTaskUpdateStatus(args) {
    const { currentStatus, requestedStatus, assignedTo, assignedToProvided } = args;
    if (requestedStatus !== undefined)
        return requestedStatus;
    if (!assignedToProvided)
        return undefined;
    if (hasAssignee(assignedTo) && currentStatus === 'inbox')
        return 'assigned';
    if (!hasAssignee(assignedTo) && currentStatus === 'assigned')
        return 'inbox';
    return undefined;
}
