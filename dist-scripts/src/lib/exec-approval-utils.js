"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesGlobPattern = matchesGlobPattern;
exports.findMatchingPatterns = findMatchingPatterns;
/**
 * Glob-style pattern matching for exec approval allowlists.
 * Supports `*` as a wildcard that matches any characters.
 */
function matchesGlobPattern(pattern, command) {
    const p = pattern.toLowerCase().trim();
    const c = command.toLowerCase().trim();
    if (!p)
        return false;
    if (p === c)
        return true;
    if (!p.includes('*'))
        return false;
    const regex = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return regex.test(c);
}
/**
 * Find all patterns from a list that match a given command.
 */
function findMatchingPatterns(patterns, command) {
    return patterns.filter(pattern => matchesGlobPattern(pattern, command));
}
