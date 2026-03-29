"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCompletedSteps = parseCompletedSteps;
exports.nextIncompleteStepIndex = nextIncompleteStepIndex;
exports.shouldShowOnboarding = shouldShowOnboarding;
exports.markStepCompleted = markStepCompleted;
function parseCompletedSteps(raw, validSteps) {
    const valid = new Set(validSteps.map((step) => step.id));
    try {
        const parsed = JSON.parse(raw || '[]');
        if (!Array.isArray(parsed))
            return [];
        const seen = new Set();
        const cleaned = [];
        for (const value of parsed) {
            if (typeof value !== 'string')
                continue;
            if (!valid.has(value))
                continue;
            if (seen.has(value))
                continue;
            seen.add(value);
            cleaned.push(value);
        }
        return cleaned;
    }
    catch (_a) {
        return [];
    }
}
function nextIncompleteStepIndex(steps, completedSteps) {
    if (steps.length === 0)
        return 0;
    const completed = new Set(completedSteps);
    const index = steps.findIndex((step) => !completed.has(step.id));
    return index === -1 ? steps.length - 1 : index;
}
function shouldShowOnboarding(params) {
    return !params.completed && !params.skipped && params.isAdmin;
}
function markStepCompleted(existingCompletedSteps, stepId, validSteps) {
    const valid = new Set(validSteps.map((step) => step.id));
    if (!valid.has(stepId))
        return [...existingCompletedSteps];
    const completed = parseCompletedSteps(JSON.stringify(existingCompletedSteps), validSteps);
    if (completed.includes(stepId))
        return completed;
    return [...completed, stepId];
}
