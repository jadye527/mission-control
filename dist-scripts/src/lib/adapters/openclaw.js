"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenClawAdapter = void 0;
const event_bus_1 = require("@/lib/event-bus");
const adapter_1 = require("./adapter");
class OpenClawAdapter {
    constructor() {
        this.framework = 'openclaw';
    }
    async register(agent) {
        event_bus_1.eventBus.broadcast('agent.created', Object.assign({ id: agent.agentId, name: agent.name, framework: this.framework, status: 'online' }, agent.metadata));
    }
    async heartbeat(payload) {
        event_bus_1.eventBus.broadcast('agent.status_changed', {
            id: payload.agentId,
            status: payload.status,
            metrics: payload.metrics,
            framework: this.framework,
        });
    }
    async reportTask(report) {
        event_bus_1.eventBus.broadcast('task.updated', {
            id: report.taskId,
            agentId: report.agentId,
            progress: report.progress,
            status: report.status,
            output: report.output,
            framework: this.framework,
        });
    }
    async getAssignments(agentId) {
        return (0, adapter_1.queryPendingAssignments)(agentId);
    }
    async disconnect(agentId) {
        event_bus_1.eventBus.broadcast('agent.status_changed', {
            id: agentId,
            status: 'offline',
            framework: this.framework,
        });
    }
}
exports.OpenClawAdapter = OpenClawAdapter;
