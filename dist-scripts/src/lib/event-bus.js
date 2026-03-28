var _a;
import { EventEmitter } from 'events';
class ServerEventBus extends EventEmitter {
    constructor() {
        super();
        this.setMaxListeners(50);
    }
    static getInstance() {
        if (!ServerEventBus.instance) {
            ServerEventBus.instance = new ServerEventBus();
        }
        return ServerEventBus.instance;
    }
    /**
     * Broadcast an event to all SSE listeners
     */
    broadcast(type, data) {
        const event = { type, data, timestamp: Date.now() };
        this.emit('server-event', event);
        return event;
    }
}
ServerEventBus.instance = null;
// Use globalThis to survive HMR in development
const globalBus = globalThis;
export const eventBus = (_a = globalBus.__eventBus) !== null && _a !== void 0 ? _a : ServerEventBus.getInstance();
globalBus.__eventBus = eventBus;
