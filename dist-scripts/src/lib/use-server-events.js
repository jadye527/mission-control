"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.useServerEvents = useServerEvents;
const react_1 = require("react");
const store_1 = require("@/store");
const client_logger_1 = require("@/lib/client-logger");
const log = (0, client_logger_1.createClientLogger)('SSE');
/**
 * Hook that connects to the SSE endpoint (/api/events) and dispatches
 * real-time DB mutation events to the Zustand store.
 *
 * SSE provides instant updates for all local-DB data (tasks, agents,
 * chat, activities, notifications), making REST polling a fallback.
 */
const SSE_MAX_RECONNECT_ATTEMPTS = 20;
const SSE_BASE_DELAY_MS = 1000;
const SSE_MAX_DELAY_MS = 30000;
function useServerEvents() {
    const eventSourceRef = (0, react_1.useRef)(null);
    const reconnectTimeoutRef = (0, react_1.useRef)(undefined);
    const sseReconnectAttemptsRef = (0, react_1.useRef)(0);
    const { setConnection, addTask, updateTask, deleteTask, addAgent, updateAgent, addChatMessage, addNotification, addActivity, } = (0, store_1.useMissionControl)();
    (0, react_1.useEffect)(() => {
        let mounted = true;
        function connect() {
            if (!mounted)
                return;
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
            const es = new EventSource('/api/events');
            eventSourceRef.current = es;
            es.onopen = () => {
                if (!mounted)
                    return;
                sseReconnectAttemptsRef.current = 0;
                setConnection({ sseConnected: true });
            };
            es.onmessage = (event) => {
                if (!mounted)
                    return;
                try {
                    const payload = JSON.parse(event.data);
                    dispatch(payload);
                }
                catch (_a) {
                    // Ignore malformed events
                }
            };
            es.onerror = () => {
                if (!mounted)
                    return;
                setConnection({ sseConnected: false });
                es.close();
                eventSourceRef.current = null;
                const attempts = sseReconnectAttemptsRef.current;
                if (attempts >= SSE_MAX_RECONNECT_ATTEMPTS) {
                    log.error(`Max reconnect attempts (${SSE_MAX_RECONNECT_ATTEMPTS}) reached`);
                    return;
                }
                // Exponential backoff with jitter
                const base = Math.min(Math.pow(2, attempts) * SSE_BASE_DELAY_MS, SSE_MAX_DELAY_MS);
                const delay = Math.round(base + Math.random() * base * 0.5);
                sseReconnectAttemptsRef.current = attempts + 1;
                log.warn(`Reconnecting in ${delay}ms (attempt ${attempts + 1}/${SSE_MAX_RECONNECT_ATTEMPTS})`);
                reconnectTimeoutRef.current = setTimeout(() => {
                    if (mounted)
                        connect();
                }, delay);
            };
        }
        function dispatch(event) {
            var _a, _b, _c, _d, _e, _f, _g;
            switch (event.type) {
                case 'connected':
                    // Initial connection ack, nothing to do
                    break;
                // Task events
                case 'task.created':
                    addTask(event.data);
                    break;
                case 'task.updated':
                    if ((_a = event.data) === null || _a === void 0 ? void 0 : _a.id) {
                        updateTask(event.data.id, event.data);
                    }
                    break;
                case 'task.status_changed':
                    if ((_b = event.data) === null || _b === void 0 ? void 0 : _b.id) {
                        updateTask(event.data.id, {
                            status: event.data.status,
                            updated_at: event.data.updated_at,
                        });
                    }
                    break;
                case 'task.deleted':
                    if ((_c = event.data) === null || _c === void 0 ? void 0 : _c.id) {
                        deleteTask(event.data.id);
                    }
                    break;
                // Agent events
                case 'agent.created':
                    addAgent(event.data);
                    break;
                case 'agent.updated':
                case 'agent.status_changed':
                    if ((_d = event.data) === null || _d === void 0 ? void 0 : _d.id) {
                        updateAgent(event.data.id, event.data);
                    }
                    break;
                // Chat events
                case 'chat.message':
                    if ((_e = event.data) === null || _e === void 0 ? void 0 : _e.id) {
                        addChatMessage({
                            id: event.data.id,
                            conversation_id: event.data.conversation_id,
                            from_agent: event.data.from_agent,
                            to_agent: event.data.to_agent,
                            content: event.data.content,
                            message_type: event.data.message_type || 'text',
                            metadata: event.data.metadata,
                            read_at: event.data.read_at,
                            created_at: event.data.created_at || Math.floor(Date.now() / 1000),
                        });
                    }
                    break;
                // Notification events
                case 'notification.created':
                    if ((_f = event.data) === null || _f === void 0 ? void 0 : _f.id) {
                        addNotification({
                            id: event.data.id,
                            recipient: event.data.recipient || 'operator',
                            type: event.data.type || 'info',
                            title: event.data.title || '',
                            message: event.data.message || '',
                            source_type: event.data.source_type,
                            source_id: event.data.source_id,
                            created_at: event.data.created_at || Math.floor(Date.now() / 1000),
                        });
                    }
                    break;
                // Activity events
                case 'activity.created':
                    if ((_g = event.data) === null || _g === void 0 ? void 0 : _g.id) {
                        addActivity({
                            id: event.data.id,
                            type: event.data.type,
                            entity_type: event.data.entity_type,
                            entity_id: event.data.entity_id,
                            actor: event.data.actor,
                            description: event.data.description,
                            data: event.data.data,
                            created_at: event.data.created_at || Math.floor(Date.now() / 1000),
                        });
                    }
                    break;
            }
        }
        connect();
        return () => {
            mounted = false;
            if (reconnectTimeoutRef.current)
                clearTimeout(reconnectTimeoutRef.current);
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            setConnection({ sseConnected: false });
        };
    }, [
        setConnection,
        addTask,
        updateTask,
        deleteTask,
        addAgent,
        updateAgent,
        addChatMessage,
        addNotification,
        addActivity,
    ]);
}
