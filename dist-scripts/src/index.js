"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.useMissionControl = void 0;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
exports.useMissionControl = (0, zustand_1.create)()((0, middleware_1.subscribeWithSelector)((set, get) => ({
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
        spawnRequests: [request, ...state.spawnRequests],
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
    setMemoryFiles: (files) => set({ memoryFiles: files }),
    setSelectedMemoryFile: (path) => set({ selectedMemoryFile: path }),
    setMemoryContent: (content) => set({ memoryContent: content }),
    // Token Usage
    tokenUsage: [],
    addTokenUsage: (usage) => set((state) => ({
        tokenUsage: [...state.tokenUsage, usage],
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
    availableModels: [
        { alias: 'haiku', name: 'anthropic/claude-3-5-haiku-latest', provider: 'anthropic', description: 'Ultra-cheap, simple tasks', costPer1k: 0.25 },
        { alias: 'sonnet', name: 'anthropic/claude-sonnet-4-20250514', provider: 'anthropic', description: 'Standard workhorse', costPer1k: 3.0 },
        { alias: 'opus', name: 'anthropic/claude-opus-4-5', provider: 'anthropic', description: 'Premium quality', costPer1k: 15.0 },
        { alias: 'deepseek', name: 'ollama/deepseek-r1:14b', provider: 'ollama', description: 'Local reasoning (free)', costPer1k: 0.0 },
        { alias: 'groq-fast', name: 'groq/llama-3.1-8b-instant', provider: 'groq', description: '840 tok/s, ultra fast', costPer1k: 0.05 },
        { alias: 'groq', name: 'groq/llama-3.3-70b-versatile', provider: 'groq', description: 'Fast + quality balance', costPer1k: 0.59 },
        { alias: 'kimi', name: 'moonshot/kimi-k2.5', provider: 'moonshot', description: 'Alternative provider', costPer1k: 1.0 },
        { alias: 'minimax', name: 'minimax/minimax-m2.1', provider: 'minimax', description: 'Cost-effective (1/10th price), strong coding', costPer1k: 0.3 },
    ],
    setAvailableModels: (models) => set({ availableModels: models }),
    // Auth
    currentUser: null,
    setCurrentUser: (user) => set({ currentUser: user }),
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
        notifications: [notification, ...state.notifications],
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
