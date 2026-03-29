"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectTextDirection = detectTextDirection;
exports.validateAttachment = validateAttachment;
exports.formatFileSize = formatFileSize;
const RTL_CHAR_REGEX = /\p{Script=Hebrew}|\p{Script=Arabic}|\p{Script=Syriac}|\p{Script=Thaana}/u;
function detectTextDirection(text) {
    if (!text)
        return 'ltr';
    const skipPattern = /[\s\p{P}\p{S}]/u;
    for (const char of text) {
        if (skipPattern.test(char))
            continue;
        return RTL_CHAR_REGEX.test(char) ? 'rtl' : 'ltr';
    }
    return 'ltr';
}
function validateAttachment(file) {
    if (file.size > 10 * 1024 * 1024)
        return `File "${file.name}" exceeds 10MB limit`;
    return null;
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
