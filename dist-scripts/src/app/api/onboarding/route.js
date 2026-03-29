"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const onboarding_state_1 = require("@/lib/onboarding-state");
const ONBOARDING_STEPS = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'interface-mode', title: 'Interface' },
    { id: 'gateway-link', title: 'Gateway' },
    { id: 'credentials', title: 'Credentials' },
];
const ONBOARDING_SETTING_KEYS = {
    completed: 'onboarding.completed',
    completedAt: 'onboarding.completed_at',
    skipped: 'onboarding.skipped',
    completedSteps: 'onboarding.completed_steps',
    checklistDismissed: 'onboarding.checklist_dismissed',
};
function scopedOnboardingKey(key, username) {
    return `user.${username}.${key}`;
}
function getOnboardingSetting(key) {
    var _a;
    try {
        const db = (0, db_1.getDatabase)();
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return (_a = row === null || row === void 0 ? void 0 : row.value) !== null && _a !== void 0 ? _a : '';
    }
    catch (_b) {
        return '';
    }
}
function setOnboardingSetting(key, value, actor) {
    const db = (0, db_1.getDatabase)();
    db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, 'onboarding', ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `).run(key, value, `Onboarding: ${key}`, actor);
}
function readUserOnboardingSetting(key, username) {
    const scopedValue = getOnboardingSetting(scopedOnboardingKey(key, username));
    if (scopedValue !== '')
        return scopedValue;
    return getOnboardingSetting(key);
}
function writeUserOnboardingSetting(key, value, actor) {
    setOnboardingSetting(scopedOnboardingKey(key, actor), value, actor);
}
async function GET(request) {
    const auth = (0, auth_1.requireRole)(request, 'viewer');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const completed = readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, auth.user.username) === 'true';
        const skipped = readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, auth.user.username) === 'true';
        const checklistDismissed = readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, auth.user.username) === 'true';
        const completedStepsRaw = readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, auth.user.username);
        const completedSteps = (0, onboarding_state_1.parseCompletedSteps)(completedStepsRaw, ONBOARDING_STEPS);
        const isAdmin = auth.user.role === 'admin';
        const showOnboarding = (0, onboarding_state_1.shouldShowOnboarding)({ completed, skipped, isAdmin });
        const steps = ONBOARDING_STEPS.map((s) => (Object.assign(Object.assign({}, s), { completed: completedSteps.includes(s.id) })));
        const currentStep = (0, onboarding_state_1.nextIncompleteStepIndex)(ONBOARDING_STEPS, completedSteps);
        return server_1.NextResponse.json({
            showOnboarding,
            completed,
            skipped,
            checklistDismissed,
            isAdmin,
            currentStep: currentStep === -1 ? steps.length - 1 : currentStep,
            steps,
        });
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Onboarding GET error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
async function POST(request) {
    const auth = (0, auth_1.requireRole)(request, 'admin');
    if ('error' in auth)
        return server_1.NextResponse.json({ error: auth.error }, { status: auth.status });
    try {
        const body = await request.json();
        const { action, step } = body;
        switch (action) {
            case 'complete_step': {
                if (!step)
                    return server_1.NextResponse.json({ error: 'step is required' }, { status: 400 });
                const valid = ONBOARDING_STEPS.some(s => s.id === step);
                if (!valid)
                    return server_1.NextResponse.json({ error: 'Invalid step' }, { status: 400 });
                const raw = readUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, auth.user.username);
                const parsed = (0, onboarding_state_1.parseCompletedSteps)(raw, ONBOARDING_STEPS);
                const steps = (0, onboarding_state_1.markStepCompleted)(parsed, step, ONBOARDING_STEPS);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, JSON.stringify(steps), auth.user.username);
                return server_1.NextResponse.json({ ok: true, completedSteps: steps });
            }
            case 'complete': {
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, 'true', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, String(Date.now()), auth.user.username);
                return server_1.NextResponse.json({ ok: true });
            }
            case 'skip': {
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, 'true', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, String(Date.now()), auth.user.username);
                return server_1.NextResponse.json({ ok: true });
            }
            case 'dismiss_checklist': {
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, 'true', auth.user.username);
                return server_1.NextResponse.json({ ok: true });
            }
            case 'reset': {
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completed, 'false', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedAt, '', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.skipped, 'false', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.completedSteps, '[]', auth.user.username);
                writeUserOnboardingSetting(ONBOARDING_SETTING_KEYS.checklistDismissed, 'false', auth.user.username);
                return server_1.NextResponse.json({ ok: true });
            }
            default:
                return server_1.NextResponse.json({ error: 'Invalid action' }, { status: 400 });
        }
    }
    catch (error) {
        logger_1.logger.error({ err: error }, 'Onboarding POST error');
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
