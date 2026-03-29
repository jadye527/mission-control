"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATEWAY_STEPS = exports.BASE_STEPS = void 0;
exports.getWizardSteps = getWizardSteps;
exports.clampWizardStep = clampWizardStep;
exports.stepIdAt = stepIdAt;
exports.BASE_STEPS = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'interface-mode', title: 'Interface' },
    { id: 'credentials', title: 'Credentials' },
];
exports.GATEWAY_STEPS = [
    { id: 'welcome', title: 'Welcome' },
    { id: 'interface-mode', title: 'Interface' },
    { id: 'gateway-link', title: 'Gateway' },
    { id: 'credentials', title: 'Credentials' },
];
function getWizardSteps(gatewayConnected) {
    return gatewayConnected ? exports.GATEWAY_STEPS : exports.BASE_STEPS;
}
function clampWizardStep(step, stepsLength) {
    if (stepsLength <= 0)
        return 0;
    if (step < 0)
        return 0;
    if (step >= stepsLength)
        return stepsLength - 1;
    return step;
}
function stepIdAt(step, steps) {
    var _a;
    return (_a = steps[clampWizardStep(step, steps.length)]) === null || _a === void 0 ? void 0 : _a.id;
}
