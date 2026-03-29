"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTaskImplementationTarget = resolveTaskImplementationTarget;
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function parseMetadata(metadata) {
    if (!metadata)
        return {};
    if (typeof metadata === 'string') {
        try {
            const parsed = JSON.parse(metadata);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
            return {};
        }
        catch (_a) {
            return {};
        }
    }
    if (typeof metadata === 'object' && !Array.isArray(metadata)) {
        return metadata;
    }
    return {};
}
function resolveTaskImplementationTarget(task) {
    const metadata = parseMetadata(task.metadata);
    const implementationRepoCandidates = [
        metadata.implementation_repo,
        metadata.implementationRepo,
        metadata.github_repo,
    ];
    const codeLocationCandidates = [
        metadata.code_location,
        metadata.codeLocation,
        metadata.path,
    ];
    const implementation_repo = implementationRepoCandidates.find(isNonEmptyString);
    const code_location = codeLocationCandidates.find(isNonEmptyString);
    return Object.assign(Object.assign({}, (implementation_repo ? { implementation_repo } : {})), (code_location ? { code_location } : {}));
}
