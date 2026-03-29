"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICE_ZONES = void 0;
exports.getZoneByRole = getZoneByRole;
exports.buildOfficeLayout = buildOfficeLayout;
exports.OFFICE_ZONES = [
    {
        id: 'engineering',
        label: 'Engineering Bay',
        icon: '🧑‍💻',
        accentClass: 'border-cyan-500/30 bg-cyan-500/10',
        roleKeywords: ['engineer', 'dev', 'frontend', 'backend', 'fullstack', 'software'],
    },
    {
        id: 'operations',
        label: 'Operations Pod',
        icon: '🛠️',
        accentClass: 'border-amber-500/30 bg-amber-500/10',
        roleKeywords: ['ops', 'sre', 'infra', 'platform', 'reliability'],
    },
    {
        id: 'research',
        label: 'Research Corner',
        icon: '🔬',
        accentClass: 'border-violet-500/30 bg-violet-500/10',
        roleKeywords: ['research', 'science', 'analyst', 'ai'],
    },
    {
        id: 'product',
        label: 'Product Studio',
        icon: '📐',
        accentClass: 'border-emerald-500/30 bg-emerald-500/10',
        roleKeywords: ['product', 'pm', 'design', 'ux', 'ui'],
    },
    {
        id: 'quality',
        label: 'Quality Lab',
        icon: '🧪',
        accentClass: 'border-rose-500/30 bg-rose-500/10',
        roleKeywords: ['qa', 'test', 'quality'],
    },
    {
        id: 'general',
        label: 'General Workspace',
        icon: '🏢',
        accentClass: 'border-slate-500/30 bg-slate-500/10',
        roleKeywords: [],
    },
];
function normalizeRole(role) {
    return String(role || '').toLowerCase();
}
function getZoneByRole(role) {
    const normalized = normalizeRole(role);
    for (const zone of exports.OFFICE_ZONES) {
        if (zone.id === 'general')
            continue;
        if (zone.roleKeywords.some((keyword) => normalized.includes(keyword))) {
            return zone;
        }
    }
    return exports.OFFICE_ZONES.find((zone) => zone.id === 'general');
}
function buildAnchor(index, columnCount) {
    const row = Math.floor(index / columnCount);
    const col = index % columnCount;
    const rowLabel = String.fromCharCode(65 + row);
    const seatLabel = `${rowLabel}${col + 1}`;
    return {
        deskId: `desk-${seatLabel.toLowerCase()}`,
        seatLabel,
        row,
        col,
        // Useful for future absolute-position movement/collision mechanics.
        x: col * 220 + 110,
        y: row * 160 + 80,
    };
}
function buildOfficeLayout(agents) {
    const zoneMap = new Map();
    for (const zone of exports.OFFICE_ZONES)
        zoneMap.set(zone.id, []);
    for (const agent of agents) {
        const zone = getZoneByRole(agent.role);
        zoneMap.get(zone.id).push(agent);
    }
    const result = [];
    for (const zone of exports.OFFICE_ZONES) {
        const workers = zoneMap.get(zone.id) || [];
        if (workers.length === 0)
            continue;
        const columns = workers.length >= 8 ? 4 : workers.length >= 4 ? 3 : 2;
        const zoned = workers.map((agent, i) => ({
            agent,
            anchor: buildAnchor(i, columns),
        }));
        result.push({ zone, workers: zoned });
    }
    return result.sort((a, b) => b.workers.length - a.workers.length);
}
