"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProvider = detectProvider;
exports.generateCsvContent = generateCsvContent;
exports.applyTimezoneOffset = applyTimezoneOffset;
function detectProvider(model) {
    const lower = model.toLowerCase();
    if (lower.includes('claude') || lower.includes('anthropic'))
        return 'Anthropic';
    if (lower.includes('gpt') || lower.includes('o1') || lower.includes('o3') || lower.includes('o4') || lower.includes('openai'))
        return 'OpenAI';
    if (lower.includes('gemini') || lower.includes('google'))
        return 'Google';
    if (lower.includes('mistral') || lower.includes('mixtral'))
        return 'Mistral';
    if (lower.includes('venice'))
        return 'Venice AI';
    if (lower.includes('llama') || lower.includes('meta'))
        return 'Meta';
    if (lower.includes('deepseek'))
        return 'DeepSeek';
    if (lower.includes('command') || lower.includes('cohere'))
        return 'Cohere';
    return 'Other';
}
function generateCsvContent(data, columns) {
    const escapeField = (value) => {
        const str = String(value !== null && value !== void 0 ? value : '');
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };
    const rows = [columns.join(',')];
    for (const row of data) {
        rows.push(columns.map(col => escapeField(row[col])).join(','));
    }
    return rows.join('\n');
}
function applyTimezoneOffset(timestamp, offsetHours) {
    const date = new Date(timestamp);
    const adjusted = new Date(date.getTime() + offsetHours * 3600000);
    return adjusted.toISOString();
}
