"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getModelPricing = getModelPricing;
exports.calculateTokenCost = calculateTokenCost;
const provider_subscriptions_1 = require("@/lib/provider-subscriptions");
const DEFAULT_MODEL_PRICING = {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
};
const MODEL_PRICING = {
    'anthropic/claude-3-5-haiku-latest': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
    'claude-3-5-haiku': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
    'anthropic/claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
    'claude-haiku-4-5': { inputPerMTok: 0.8, outputPerMTok: 4.0 },
    'anthropic/claude-sonnet-4-20250514': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'claude-sonnet-4': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'anthropic/claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'claude-sonnet-4-5': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'anthropic/claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    'anthropic/claude-opus-4-5': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
    'claude-opus-4-5': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
    'anthropic/claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
    'claude-opus-4-6': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
    // For non-Anthropic models where we only have one published blended estimate,
    // apply the same rate for both input and output.
    'groq/llama-3.1-8b-instant': { inputPerMTok: 0.05, outputPerMTok: 0.05 },
    'groq/llama-3.3-70b-versatile': { inputPerMTok: 0.59, outputPerMTok: 0.59 },
    'moonshot/kimi-k2.5': { inputPerMTok: 1.0, outputPerMTok: 1.0 },
    'venice/llama-3.3-70b': { inputPerMTok: 0.7, outputPerMTok: 2.8 },
    'minimax/minimax-m2.1': { inputPerMTok: 0.3, outputPerMTok: 0.3 },
    'ollama/deepseek-r1:14b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
    'ollama/qwen2.5-coder:7b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
    'ollama/qwen2.5-coder:14b': { inputPerMTok: 0.0, outputPerMTok: 0.0 },
};
function normalizedModelName(modelName) {
    return modelName.trim().toLowerCase();
}
function getModelPricing(modelName) {
    const normalized = normalizedModelName(modelName);
    if (MODEL_PRICING[normalized] !== undefined)
        return MODEL_PRICING[normalized];
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
        const shortName = model.split('/').pop() || model;
        if (normalized.includes(shortName))
            return pricing;
    }
    return DEFAULT_MODEL_PRICING;
}
function calculateTokenCost(modelName, inputTokens, outputTokens, options) {
    var _a;
    const provider = (0, provider_subscriptions_1.getProviderFromModel)(modelName);
    if (provider !== 'unknown' && ((_a = options === null || options === void 0 ? void 0 : options.providerSubscriptions) === null || _a === void 0 ? void 0 : _a[provider])) {
        return 0;
    }
    const pricing = getModelPricing(modelName);
    return ((inputTokens * pricing.inputPerMTok) + (outputTokens * pricing.outputPerMTok)) / 1000000;
}
