"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMissionControl = void 0;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
const models_1 = require("@/lib/models");
exports.useMissionControl = (0, zustand_1.create)()((0, middleware_1.subscribeWithSelector)((set, get) => ({
    // Dashboard Mode
    dashboardMode: 'local',
    gatewayAvailable: false,
    localSessionsAvailable: false,
    bannerDismissed: false,
    capabilitiesChecked: false,
    bootComplete: false,
    subscription: null,
    defaultOrgName: 'Default',
    setDashboardMode: (mode) => set({ dashboardMode: mode }),
    setGatewayAvailable: (available) => set({ gatewayAvailable: available }),
    setLocalSessionsAvailable: (available) => set({ localSessionsAvailable: available }),
    dismissBanner: () => set({ bannerDismissed: true }),
    setCapabilitiesChecked: (checked) => set({ capabilitiesChecked: checked }),
    setBootComplete: () => set({ bootComplete: true }),
    setSubscription: (sub) => set({ subscription: sub }),
    setDefaultOrgName: (name) => set({ defaultOrgName: name }),
    // Onboarding
    showOnboarding: false,
    setShowOnboarding: (show) => set({ showOnboarding: show }),
    // Update availability
    updateAvailable: null,
    updateDismissedVersion: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            return localStorage.getItem('mc-update-dismissed-version');
        }
        catch (_a) {
            return null;
        }
    })(),
    setUpdateAvailable: (info) => set({ updateAvailable: info }),
    dismissUpdate: (version) => {
        try {
            localStorage.setItem('mc-update-dismissed-version', version);
        }
        catch (_a) { }
        set({ updateDismissedVersion: version });
    },
    // OpenClaw update availability
    openclawUpdate: null,
    openclawUpdateDismissedVersion: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            return localStorage.getItem('mc-openclaw-update-dismissed');
        }
        catch (_a) {
            return null;
        }
    })(),
    setOpenclawUpdate: (info) => set({ openclawUpdate: info }),
    dismissOpenclawUpdate: (version) => {
        try {
            localStorage.setItem('mc-openclaw-update-dismissed', version);
        }
        catch (_a) { }
        set({ openclawUpdateDismissedVersion: version });
    },
    // OpenClaw Doctor banner dismiss
    doctorDismissedAt: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            const raw = localStorage.getItem('mc-doctor-dismissed-at');
            return raw ? Number(raw) : null;
        }
        catch (_a) {
            return null;
        }
    })(),
    dismissDoctor: () => {
        const now = Date.now();
        try {
            localStorage.setItem('mc-doctor-dismissed-at', String(now));
        }
        catch (_a) { }
        set({ doctorDismissedAt: now });
    },
    // Connection state
    connection: {
        isConnected: false,
        url: '',
        reconnectAttempts: 0
    },
    lastMessage: null,
    setConnection: (connection) => set((state) => ({
        connection: Object.assign(Object.assign({}, state.connection), connection)
    })),
    setLastMessage: (message) => set({ lastMessage: message }),
    // Sessions
    sessions: [],
    selectedSession: null,
    setSessions: (sessions) => set({ sessions }),
    setSelectedSession: (sessionId) => set({ selectedSession: sessionId }),
    updateSession: (sessionId, updates) => set((state) => ({
        sessions: state.sessions.map((session) => session.id === sessionId ? Object.assign(Object.assign({}, session), updates) : session),
    })),
    // Logs
    logs: [],
    logFilters: {},
    addLog: (log) => set((state) => {
        // Check if log already exists to prevent duplicates
        const existingLogIndex = state.logs.findIndex(existingLog => existingLog.id === log.id);
        if (existingLogIndex !== -1) {
            // Update existing log
            const updatedLogs = [...state.logs];
            updatedLogs[existingLogIndex] = log;
            return { logs: updatedLogs };
        }
        // Add new log at the beginning (newest first)
        return {
            logs: [log, ...state.logs].slice(0, 1000), // Keep last 1000 logs
        };
    }),
    setLogFilters: (filters) => set((state) => ({
        logFilters: Object.assign(Object.assign({}, state.logFilters), filters),
    })),
    clearLogs: () => set({ logs: [] }),
    // Agent Spawning
    spawnRequests: [],
    addSpawnRequest: (request) => set((state) => ({
        spawnRequests: [request, ...state.spawnRequests].slice(0, 500),
    })),
    updateSpawnRequest: (id, updates) => set((state) => ({
        spawnRequests: state.spawnRequests.map((req) => req.id === id ? Object.assign(Object.assign({}, req), updates) : req),
    })),
    // Cron Management
    cronJobs: [],
    setCronJobs: (jobs) => set({ cronJobs: jobs }),
    updateCronJob: (name, updates) => set((state) => ({
        cronJobs: state.cronJobs.map((job) => job.name === name ? Object.assign(Object.assign({}, job), updates) : job),
    })),
    // Memory Browser
    memoryFiles: [],
    selectedMemoryFile: null,
    memoryContent: null,
    memoryFileLinks: null,
    memoryHealth: null,
    setMemoryFiles: (files) => set({ memoryFiles: files }),
    setSelectedMemoryFile: (path) => set({ selectedMemoryFile: path }),
    setMemoryContent: (content) => set({ memoryContent: content }),
    setMemoryFileLinks: (links) => set({ memoryFileLinks: links }),
    setMemoryHealth: (health) => set({ memoryHealth: health }),
    // Token Usage
    tokenUsage: [],
    addTokenUsage: (usage) => set((state) => ({
        tokenUsage: [...state.tokenUsage, usage].slice(-2000),
    })),
    getUsageByModel: (timeframe) => {
        const { tokenUsage } = get();
        const now = new Date();
        let cutoff;
        switch (timeframe) {
            case 'day':
                cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'week':
                cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                cutoff = new Date(0);
        }
        return tokenUsage
            .filter((usage) => new Date(usage.date) >= cutoff)
            .reduce((acc, usage) => {
            acc[usage.model] = (acc[usage.model] || 0) + usage.totalTokens;
            return acc;
        }, {});
    },
    getTotalCost: (timeframe) => {
        const { tokenUsage } = get();
        const now = new Date();
        let cutoff;
        switch (timeframe) {
            case 'day':
                cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case 'week':
                cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'month':
                cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            default:
                cutoff = new Date(0);
        }
        return tokenUsage
            .filter((usage) => new Date(usage.date) >= cutoff)
            .reduce((acc, usage) => acc + usage.cost, 0);
    },
    // Model Configuration
    availableModels: [...models_1.MODEL_CATALOG],
    setAvailableModels: (models) => set({ availableModels: models }),
    // Auth
    currentUser: null,
    setCurrentUser: (user) => set({ currentUser: user }),
    activeWorkspace: null,
    workspaces: [],
    setActiveWorkspace: (workspace) => set({ activeWorkspace: workspace }),
    setWorkspaces: (workspaces) => set({ workspaces }),
    fetchWorkspaces: async () => {
        try {
            const res = await fetch('/api/workspaces', { cache: 'no-store' });
            if (!res.ok)
                return;
            const data = await res.json();
            const workspaceList = Array.isArray(data === null || data === void 0 ? void 0 : data.workspaces) ? data.workspaces : [];
            const activeWorkspace = workspaceList.find((workspace) => workspace.id === (data === null || data === void 0 ? void 0 : data.active_workspace_id)) || null;
            set({
                workspaces: workspaceList,
                activeWorkspace,
            });
        }
        catch (_a) { }
    },
    // Tenant / Organization context
    activeTenant: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            const raw = localStorage.getItem('mc-active-tenant');
            return raw ? JSON.parse(raw) : null;
        }
        catch (_a) {
            return null;
        }
    })(),
    tenants: [],
    osUsers: [],
    setActiveTenant: (tenant) => {
        try {
            if (tenant) {
                localStorage.setItem('mc-active-tenant', JSON.stringify(tenant));
            }
            else {
                localStorage.removeItem('mc-active-tenant');
            }
        }
        catch (_a) { }
        set({ activeTenant: tenant });
    },
    setTenants: (tenants) => set({ tenants }),
    fetchTenants: async () => {
        try {
            const res = await fetch('/api/super/tenants', { cache: 'no-store' });
            if (!res.ok)
                return;
            const data = await res.json();
            const tenantList = Array.isArray(data === null || data === void 0 ? void 0 : data.tenants) ? data.tenants : [];
            set({ tenants: tenantList });
        }
        catch (_a) { }
    },
    fetchOsUsers: async () => {
        try {
            const res = await fetch('/api/super/os-users', { cache: 'no-store' });
            if (!res.ok)
                return;
            const data = await res.json();
            set({ osUsers: Array.isArray(data === null || data === void 0 ? void 0 : data.users) ? data.users : [] });
        }
        catch (_a) { }
    },
    // Project context
    activeProject: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            const raw = localStorage.getItem('mc-active-project');
            return raw ? JSON.parse(raw) : null;
        }
        catch (_a) {
            return null;
        }
    })(),
    projects: [],
    setActiveProject: (project) => {
        try {
            if (project) {
                localStorage.setItem('mc-active-project', JSON.stringify(project));
            }
            else {
                localStorage.removeItem('mc-active-project');
            }
        }
        catch (_a) { }
        set({ activeProject: project });
    },
    setProjects: (projects) => set({ projects }),
    fetchProjects: async () => {
        try {
            const res = await fetch('/api/projects', { cache: 'no-store' });
            if (!res.ok)
                return;
            const data = await res.json();
            const projectList = Array.isArray(data === null || data === void 0 ? void 0 : data.projects) ? data.projects : [];
            set({ projects: projectList });
        }
        catch (_a) { }
    },
    // Project Manager Modal (global)
    showProjectManagerModal: false,
    setShowProjectManagerModal: (show) => set({ showProjectManagerModal: show }),
    // Exec Approvals
    execApprovals: [],
    setExecApprovals: (approvals) => set({ execApprovals: approvals }),
    addExecApproval: (approval) => set((state) => {
        if (state.execApprovals.some(a => a.id === approval.id))
            return state;
        return { execApprovals: [approval, ...state.execApprovals].slice(0, 200) };
    }),
    updateExecApproval: (id, updates) => set((state) => ({
        execApprovals: state.execApprovals.map(a => a.id === id ? Object.assign(Object.assign({}, a), updates) : a),
    })),
    // Skills
    skillsList: null,
    skillGroups: null,
    skillsTotal: 0,
    setSkillsData: (skills, groups, total) => set({ skillsList: skills, skillGroups: groups, skillsTotal: total }),
    // Memory Graph
    memoryGraphAgents: null,
    setMemoryGraphAgents: (agents) => set({ memoryGraphAgents: agents }),
    // Security Posture
    securityPosture: undefined,
    setSecurityPosture: (posture) => set({ securityPosture: posture }),
    // Dashboard Layout
    dashboardLayout: (() => {
        if (typeof window === 'undefined')
            return null;
        try {
            const raw = localStorage.getItem('mc-dashboard-layout');
            return raw ? JSON.parse(raw) : null;
        }
        catch (_a) {
            return null;
        }
    })(),
    setDashboardLayout: (layoutOrUpdater) => {
        const currentLayout = get().dashboardLayout;
        const layout = typeof layoutOrUpdater === 'function'
            ? layoutOrUpdater(currentLayout)
            : layoutOrUpdater;
        try {
            if (layout) {
                localStorage.setItem('mc-dashboard-layout', JSON.stringify(layout));
            }
            else {
                localStorage.removeItem('mc-dashboard-layout');
            }
        }
        catch (_a) { }
        set({ dashboardLayout: layout });
    },
    // Interface Mode
    interfaceMode: 'essential',
    setInterfaceMode: (mode) => set({ interfaceMode: mode }),
    // UI State — sidebar & layout persistence
    activeTab: 'overview',
    sidebarExpanded: (() => {
        if (typeof window === 'undefined')
            return false;
        try {
            return localStorage.getItem('mc-sidebar-expanded') === 'true';
        }
        catch (_a) {
            return false;
        }
    })(),
    collapsedGroups: (() => {
        if (typeof window === 'undefined')
            return [];
        try {
            const raw = localStorage.getItem('mc-sidebar-groups');
            return raw ? JSON.parse(raw) : [];
        }
        catch (_a) {
            return [];
        }
    })(),
    liveFeedOpen: (() => {
        if (typeof window === 'undefined')
            return true;
        try {
            return localStorage.getItem('mc-livefeed-open') !== 'false';
        }
        catch (_a) {
            return true;
        }
    })(),
    headerDensity: (() => {
        if (typeof window === 'undefined')
            return 'focus';
        try {
            const raw = localStorage.getItem('mc-header-density');
            return raw === 'compact' ? 'compact' : 'focus';
        }
        catch (_a) {
            return 'focus';
        }
    })(),
    setActiveTab: (tab) => set({ activeTab: tab }),
    toggleSidebar: () => set((state) => {
        const next = !state.sidebarExpanded;
        try {
            localStorage.setItem('mc-sidebar-expanded', String(next));
        }
        catch (_a) { }
        return { sidebarExpanded: next };
    }),
    setSidebarExpanded: (expanded) => {
        try {
            localStorage.setItem('mc-sidebar-expanded', String(expanded));
        }
        catch (_a) { }
        set({ sidebarExpanded: expanded });
    },
    toggleGroup: (groupId) => set((state) => {
        const next = state.collapsedGroups.includes(groupId)
            ? state.collapsedGroups.filter(g => g !== groupId)
            : [...state.collapsedGroups, groupId];
        try {
            localStorage.setItem('mc-sidebar-groups', JSON.stringify(next));
        }
        catch (_a) { }
        return { collapsedGroups: next };
    }),
    toggleLiveFeed: () => set((state) => {
        const next = !state.liveFeedOpen;
        try {
            localStorage.setItem('mc-livefeed-open', String(next));
        }
        catch (_a) { }
        return { liveFeedOpen: next };
    }),
    setHeaderDensity: (mode) => {
        try {
            localStorage.setItem('mc-header-density', mode);
        }
        catch (_a) { }
        set({ headerDensity: mode });
    },
    // Mission Control Phase 2 - Tasks
    tasks: [],
    selectedTask: null,
    setTasks: (tasks) => set({ tasks }),
    setSelectedTask: (task) => set({ selectedTask: task }),
    addTask: (task) => set((state) => ({
        tasks: [task, ...state.tasks]
    })),
    updateTask: (taskId, updates) => set((state) => {
        var _a;
        return ({
            tasks: state.tasks.map((task) => task.id === taskId ? Object.assign(Object.assign({}, task), updates) : task),
            selectedTask: ((_a = state.selectedTask) === null || _a === void 0 ? void 0 : _a.id) === taskId
                ? Object.assign(Object.assign({}, state.selectedTask), updates) : state.selectedTask
        });
    }),
    deleteTask: (taskId) => set((state) => {
        var _a;
        return ({
            tasks: state.tasks.filter((task) => task.id !== taskId),
            selectedTask: ((_a = state.selectedTask) === null || _a === void 0 ? void 0 : _a.id) === taskId ? null : state.selectedTask
        });
    }),
    // Mission Control Phase 2 - Agents
    agents: [],
    selectedAgent: null,
    setAgents: (agents) => set({ agents }),
    setSelectedAgent: (agent) => set({ selectedAgent: agent }),
    addAgent: (agent) => set((state) => ({
        agents: [agent, ...state.agents]
    })),
    updateAgent: (agentId, updates) => set((state) => {
        var _a;
        return ({
            agents: state.agents.map((agent) => agent.id === agentId ? Object.assign(Object.assign({}, agent), updates) : agent),
            selectedAgent: ((_a = state.selectedAgent) === null || _a === void 0 ? void 0 : _a.id) === agentId
                ? Object.assign(Object.assign({}, state.selectedAgent), updates) : state.selectedAgent
        });
    }),
    deleteAgent: (agentId) => set((state) => {
        var _a;
        return ({
            agents: state.agents.filter((agent) => agent.id !== agentId),
            selectedAgent: ((_a = state.selectedAgent) === null || _a === void 0 ? void 0 : _a.id) === agentId ? null : state.selectedAgent
        });
    }),
    // Mission Control Phase 2 - Activities
    activities: [],
    setActivities: (activities) => set({ activities }),
    addActivity: (activity) => set((state) => ({
        activities: [activity, ...state.activities].slice(0, 1000) // Keep last 1000
    })),
    // Mission Control Phase 2 - Notifications
    notifications: [],
    unreadNotificationCount: 0,
    setNotifications: (notifications) => set({
        notifications,
        unreadNotificationCount: notifications.filter(n => !n.read_at).length
    }),
    addNotification: (notification) => set((state) => ({
        notifications: [notification, ...state.notifications].slice(0, 500),
        unreadNotificationCount: state.unreadNotificationCount + 1
    })),
    markNotificationRead: (notificationId) => set((state) => ({
        notifications: state.notifications.map((notification) => notification.id === notificationId
            ? Object.assign(Object.assign({}, notification), { read_at: Math.floor(Date.now() / 1000) }) : notification),
        unreadNotificationCount: Math.max(0, state.unreadNotificationCount - 1)
    })),
    markAllNotificationsRead: () => set((state) => ({
        notifications: state.notifications.map((notification) => notification.read_at ? notification : Object.assign(Object.assign({}, notification), { read_at: Math.floor(Date.now() / 1000) })),
        unreadNotificationCount: 0
    })),
    // Mission Control Phase 2 - Comments
    taskComments: {},
    setTaskComments: (taskId, comments) => set((state) => ({
        taskComments: Object.assign(Object.assign({}, state.taskComments), { [taskId]: comments })
    })),
    addTaskComment: (taskId, comment) => set((state) => ({
        taskComments: Object.assign(Object.assign({}, state.taskComments), { [taskId]: [comment, ...(state.taskComments[taskId] || [])] })
    })),
    // Agent Chat
    chatMessages: [],
    conversations: [],
    activeConversation: null,
    chatInput: '',
    isSendingMessage: false,
    chatPanelOpen: false,
    setChatMessages: (messages) => set({ chatMessages: messages.slice(-500) }),
    addChatMessage: (message) => set((state) => {
        // Deduplicate: skip if a message with the same server ID already exists
        if (message.id > 0 && state.chatMessages.some(m => m.id === message.id)) {
            return state;
        }
        const messages = [...state.chatMessages, message].slice(-500);
        const conversations = state.conversations.map((conv) => conv.id === message.conversation_id
            ? Object.assign(Object.assign({}, conv), { lastMessage: message, updatedAt: message.created_at }) : conv);
        return { chatMessages: messages, conversations };
    }),
    replacePendingMessage: (tempId, message) => set((state) => ({
        chatMessages: state.chatMessages.map(m => m.id === tempId ? Object.assign(Object.assign({}, message), { pendingStatus: 'sent' }) : m),
    })),
    updatePendingMessage: (tempId, updates) => set((state) => ({
        chatMessages: state.chatMessages.map(m => m.id === tempId ? Object.assign(Object.assign({}, m), updates) : m),
    })),
    removePendingMessage: (tempId) => set((state) => ({
        chatMessages: state.chatMessages.filter(m => m.id !== tempId),
    })),
    setConversations: (conversations) => set({ conversations }),
    setActiveConversation: (conversationId) => set({ activeConversation: conversationId }),
    setChatInput: (input) => set({ chatInput: input }),
    setIsSendingMessage: (loading) => set({ isSendingMessage: loading }),
    setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
    markConversationRead: (conversationId) => set((state) => ({
        conversations: state.conversations.map((conv) => conv.id === conversationId
            ? Object.assign(Object.assign({}, conv), { unreadCount: 0 }) : conv),
        chatMessages: state.chatMessages.map((msg) => msg.conversation_id === conversationId && !msg.read_at
            ? Object.assign(Object.assign({}, msg), { read_at: Math.floor(Date.now() / 1000) }) : msg)
    })),
    // Mission Control Phase 2 - Standup
    standupReports: [],
    currentStandupReport: null,
    setStandupReports: (reports) => set({ standupReports: reports }),
    setCurrentStandupReport: (report) => set({ currentStandupReport: report }),
})));
