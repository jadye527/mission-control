"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDayKey = buildDayKey;
exports.getCronOccurrences = getCronOccurrences;
function normalizeCronExpression(raw) {
    const trimmed = raw.trim();
    const tzSuffixMatch = trimmed.match(/^(.*)\s+\([^)]+\)$/);
    return ((tzSuffixMatch === null || tzSuffixMatch === void 0 ? void 0 : tzSuffixMatch[1]) || trimmed).trim();
}
function parseToken(token, min, max) {
    const valueSet = new Set();
    const trimmed = token.trim();
    if (trimmed === '*') {
        for (let i = min; i <= max; i += 1)
            valueSet.add(i);
        return { any: true, values: valueSet };
    }
    for (const part of trimmed.split(',')) {
        const section = part.trim();
        if (!section)
            continue;
        const [rangePart, stepPart] = section.split('/');
        const step = stepPart ? Number(stepPart) : 1;
        if (!Number.isFinite(step) || step <= 0)
            continue;
        if (rangePart === '*') {
            for (let i = min; i <= max; i += step)
                valueSet.add(i);
            continue;
        }
        if (rangePart.includes('-')) {
            const [fromRaw, toRaw] = rangePart.split('-');
            const from = Number(fromRaw);
            const to = Number(toRaw);
            if (!Number.isFinite(from) || !Number.isFinite(to))
                continue;
            const start = Math.max(min, Math.min(max, from));
            const end = Math.max(min, Math.min(max, to));
            for (let i = start; i <= end; i += step)
                valueSet.add(i);
            continue;
        }
        const single = Number(rangePart);
        if (!Number.isFinite(single))
            continue;
        if (single >= min && single <= max)
            valueSet.add(single);
    }
    return { any: false, values: valueSet };
}
function parseField(token, min, max) {
    const parsed = parseToken(token, min, max);
    return {
        any: parsed.any,
        matches: (value) => parsed.values.has(value),
    };
}
function parseCron(raw) {
    const normalized = normalizeCronExpression(raw);
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length !== 5)
        return null;
    return {
        minute: parseField(parts[0], 0, 59),
        hour: parseField(parts[1], 0, 23),
        dayOfMonth: parseField(parts[2], 1, 31),
        month: parseField(parts[3], 1, 12),
        dayOfWeek: parseField(parts[4], 0, 6),
    };
}
function matchesDay(parsed, date) {
    const dayOfMonthMatches = parsed.dayOfMonth.matches(date.getDate());
    const dayOfWeekMatches = parsed.dayOfWeek.matches(date.getDay());
    if (parsed.dayOfMonth.any && parsed.dayOfWeek.any)
        return true;
    if (parsed.dayOfMonth.any)
        return dayOfWeekMatches;
    if (parsed.dayOfWeek.any)
        return dayOfMonthMatches;
    return dayOfMonthMatches || dayOfWeekMatches;
}
function buildDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function getCronOccurrences(schedule, rangeStartMs, rangeEndMs, max = 1000) {
    if (!schedule || !Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs))
        return [];
    if (rangeEndMs <= rangeStartMs || max <= 0)
        return [];
    const parsed = parseCron(schedule);
    if (!parsed)
        return [];
    const occurrences = [];
    const cursor = new Date(rangeStartMs);
    cursor.setSeconds(0, 0);
    if (cursor.getTime() < rangeStartMs) {
        cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
    }
    while (cursor.getTime() < rangeEndMs && occurrences.length < max) {
        if (parsed.month.matches(cursor.getMonth() + 1) &&
            matchesDay(parsed, cursor) &&
            parsed.hour.matches(cursor.getHours()) &&
            parsed.minute.matches(cursor.getMinutes())) {
            occurrences.push({
                atMs: cursor.getTime(),
                dayKey: buildDayKey(cursor),
            });
        }
        cursor.setMinutes(cursor.getMinutes() + 1, 0, 0);
    }
    return occurrences;
}
