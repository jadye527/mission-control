"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrewAIAdapter = void 0;
const event_bus_1 = require("@/lib/event-bus");
const adapter_1 = require("./adapter");
class CrewAIAdapter {
    constructor() {
        this.framework = 'crewai';
    }
    async register(agent) {
        var _a;
        event_bus_1.eventBus.broadcast('agent.created', Object.assign({ id: agent.agentId, name: agent.name, framework: this.framework, status: 'online' }, ((_a = agent.metadata) !== null && _a !== void 0 ? _a : {})));
    }
    async heartbeat(payload) {
        var _a;
        event_bus_1.eventBus.broadcast('agent.status_changed', {
            id: payload.agentId,
            status: payload.status,
            metrics: (_a = payload.metrics) !== null && _a !== void 0 ? _a : {},
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
exports.CrewAIAdapter = CrewAIAdapter;
