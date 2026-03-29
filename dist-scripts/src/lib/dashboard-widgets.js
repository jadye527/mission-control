"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GATEWAY_DEFAULT_LAYOUT = exports.LOCAL_DEFAULT_LAYOUT = exports.WIDGET_CATALOG = void 0;
exports.getDefaultLayout = getDefaultLayout;
exports.getWidgetById = getWidgetById;
exports.getAvailableWidgets = getAvailableWidgets;
exports.WIDGET_CATALOG = [
    {
        id: 'metric-cards',
        label: 'Key Metrics',
        description: 'Top-line stats — sessions, load, tokens, cost',
        category: 'metrics',
        modes: ['local', 'full'],
        defaultSize: 'full',
        component: 'MetricCardsWidget',
    },
    {
        id: 'owner-cockpit',
        label: 'Owner Cockpit',
        description: 'Operational metrics — API cost, trades, signal freshness, heartbeat errors',
        category: 'metrics',
        modes: ['local', 'full'],
        defaultSize: 'lg',
        component: 'OwnerCockpitWidget',
    },
    {
        id: 'runtime-health',
        label: 'Runtime Health',
        description: 'Local OS, Claude, Codex, and MC core health',
        category: 'health',
        modes: ['local'],
        defaultSize: 'md',
        component: 'RuntimeHealthWidget',
    },
    {
        id: 'gateway-health',
        label: 'Gateway Health',
        description: 'Gateway golden signals — traffic, errors, saturation',
        category: 'health',
        modes: ['full'],
        defaultSize: 'md',
        component: 'GatewayHealthWidget',
    },
    {
        id: 'session-workbench',
        label: 'Session Workbench',
        description: 'Live session list with activity indicators',
        category: 'sessions',
        modes: ['local', 'full'],
        defaultSize: 'md',
        component: 'SessionWorkbenchWidget',
    },
    {
        id: 'event-stream',
        label: 'Event Stream',
        description: 'Merged log stream from all sources',
        category: 'events',
        modes: ['local', 'full'],
        defaultSize: 'md',
        component: 'EventStreamWidget',
    },
    {
        id: 'task-flow',
        label: 'Task Flow',
        description: 'Task status counts — inbox, assigned, in progress, review, done',
        category: 'tasks',
        modes: ['local', 'full'],
        defaultSize: 'sm',
        component: 'TaskFlowWidget',
    },
    {
        id: 'github-signal',
        label: 'GitHub Signal',
        description: 'GitHub repo stats — issues, stars, repos',
        category: 'integrations',
        modes: ['local'],
        defaultSize: 'sm',
        component: 'GithubSignalWidget',
    },
    {
        id: 'security-audit',
        label: 'Security & Audit',
        description: 'Audit events, login failures, notifications',
        category: 'events',
        modes: ['full'],
        defaultSize: 'sm',
        component: 'SecurityAuditWidget',
    },
    {
        id: 'maintenance',
        label: 'Maintenance & Backup',
        description: 'Backup status, pipeline health',
        category: 'health',
        modes: ['full'],
        defaultSize: 'sm',
        component: 'MaintenanceWidget',
    },
    {
        id: 'quick-actions',
        label: 'Quick Actions',
        description: 'Navigation shortcuts to key panels',
        category: 'sessions',
        modes: ['local', 'full'],
        defaultSize: 'full',
        component: 'QuickActionsWidget',
    },
];
exports.LOCAL_DEFAULT_LAYOUT = [
    'metric-cards',
    'owner-cockpit',
    'runtime-health',
    'session-workbench',
    'event-stream',
    'task-flow',
    'github-signal',
    'quick-actions',
];
exports.GATEWAY_DEFAULT_LAYOUT = [
    'metric-cards',
    'owner-cockpit',
    'gateway-health',
    'session-workbench',
    'event-stream',
    'task-flow',
    'security-audit',
    'maintenance',
    'quick-actions',
];
function getDefaultLayout(mode) {
    return mode === 'local' ? exports.LOCAL_DEFAULT_LAYOUT : exports.GATEWAY_DEFAULT_LAYOUT;
}
function getWidgetById(id) {
    return exports.WIDGET_CATALOG.find((w) => w.id === id);
}
function getAvailableWidgets(mode) {
    return exports.WIDGET_CATALOG.filter((w) => w.modes.includes(mode));
}
