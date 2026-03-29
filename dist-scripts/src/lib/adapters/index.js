"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdapter = getAdapter;
exports.listAdapters = listAdapters;
const openclaw_1 = require("./openclaw");
const generic_1 = require("./generic");
const crewai_1 = require("./crewai");
const langgraph_1 = require("./langgraph");
const autogen_1 = require("./autogen");
const claude_sdk_1 = require("./claude-sdk");
const adapters = {
    openclaw: () => new openclaw_1.OpenClawAdapter(),
    generic: () => new generic_1.GenericAdapter(),
    crewai: () => new crewai_1.CrewAIAdapter(),
    langgraph: () => new langgraph_1.LangGraphAdapter(),
    autogen: () => new autogen_1.AutoGenAdapter(),
    'claude-sdk': () => new claude_sdk_1.ClaudeSdkAdapter(),
};
function getAdapter(framework) {
    const factory = adapters[framework];
    if (!factory)
        throw new Error(`Unknown framework adapter: ${framework}`);
    return factory();
}
function listAdapters() {
    return Object.keys(adapters);
}
