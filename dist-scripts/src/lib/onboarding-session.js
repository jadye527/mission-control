"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ONBOARDING_SESSION_REPLAY_KEY = exports.ONBOARDING_SESSION_DISMISSED_KEY = void 0;
exports.getOnboardingSessionDecision = getOnboardingSessionDecision;
exports.readOnboardingDismissedThisSession = readOnboardingDismissedThisSession;
exports.markOnboardingDismissedThisSession = markOnboardingDismissedThisSession;
exports.clearOnboardingDismissedThisSession = clearOnboardingDismissedThisSession;
exports.readOnboardingReplayFromStart = readOnboardingReplayFromStart;
exports.markOnboardingReplayFromStart = markOnboardingReplayFromStart;
exports.clearOnboardingReplayFromStart = clearOnboardingReplayFromStart;
exports.ONBOARDING_SESSION_DISMISSED_KEY = 'mc-onboarding-dismissed';
exports.ONBOARDING_SESSION_REPLAY_KEY = 'mc-onboarding-replay';
function getOnboardingSessionDecision(params) {
    if (!params.isAdmin || params.dismissedThisSession) {
        return { shouldOpen: false, replayFromStart: false };
    }
    if (params.serverShowOnboarding) {
        return { shouldOpen: true, replayFromStart: false };
    }
    if (params.completed || params.skipped) {
        return { shouldOpen: true, replayFromStart: true };
    }
    return { shouldOpen: false, replayFromStart: false };
}
function readOnboardingDismissedThisSession() {
    if (typeof window === 'undefined')
        return false;
    try {
        return window.sessionStorage.getItem(exports.ONBOARDING_SESSION_DISMISSED_KEY) === '1';
    }
    catch (_a) {
        return false;
    }
}
function markOnboardingDismissedThisSession() {
    if (typeof window === 'undefined')
        return;
    try {
        window.sessionStorage.setItem(exports.ONBOARDING_SESSION_DISMISSED_KEY, '1');
    }
    catch (_a) { }
}
function clearOnboardingDismissedThisSession() {
    if (typeof window === 'undefined')
        return;
    try {
        window.sessionStorage.removeItem(exports.ONBOARDING_SESSION_DISMISSED_KEY);
    }
    catch (_a) { }
}
function readOnboardingReplayFromStart() {
    if (typeof window === 'undefined')
        return false;
    try {
        return window.sessionStorage.getItem(exports.ONBOARDING_SESSION_REPLAY_KEY) === '1';
    }
    catch (_a) {
        return false;
    }
}
function markOnboardingReplayFromStart() {
    if (typeof window === 'undefined')
        return;
    try {
        window.sessionStorage.setItem(exports.ONBOARDING_SESSION_REPLAY_KEY, '1');
    }
    catch (_a) { }
}
function clearOnboardingReplayFromStart() {
    if (typeof window === 'undefined')
        return;
    try {
        window.sessionStorage.removeItem(exports.ONBOARDING_SESSION_REPLAY_KEY);
    }
    catch (_a) { }
}
