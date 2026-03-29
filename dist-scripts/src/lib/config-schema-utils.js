"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemaType = schemaType;
exports.normalizeSchema = normalizeSchema;
exports.inferFieldType = inferFieldType;
exports.extractSchemaTags = extractSchemaTags;
/** Resolve the primary type from a schema node */
function schemaType(schema) {
    var _a;
    if (!schema)
        return undefined;
    if (Array.isArray(schema.type)) {
        const filtered = schema.type.filter(t => t !== 'null');
        return (_a = filtered[0]) !== null && _a !== void 0 ? _a : schema.type[0];
    }
    if (schema.type)
        return schema.type;
    if (schema.properties || schema.additionalProperties)
        return 'object';
    return undefined;
}
/** Normalize union schemas (anyOf/oneOf) into a simpler form */
function normalizeSchema(schema) {
    var _a, _b;
    if (!schema.anyOf && !schema.oneOf)
        return schema;
    const union = (_b = (_a = schema.anyOf) !== null && _a !== void 0 ? _a : schema.oneOf) !== null && _b !== void 0 ? _b : [];
    const literals = [];
    const remaining = [];
    let nullable = false;
    for (const entry of union) {
        if (!entry || typeof entry !== 'object')
            continue;
        if (Array.isArray(entry.enum)) {
            for (const v of entry.enum) {
                if (v == null) {
                    nullable = true;
                    continue;
                }
                if (!literals.some(ex => Object.is(ex, v)))
                    literals.push(v);
            }
            continue;
        }
        if ('const' in entry) {
            if (entry.const == null) {
                nullable = true;
                continue;
            }
            literals.push(entry.const);
            continue;
        }
        if (schemaType(entry) === 'null') {
            nullable = true;
            continue;
        }
        remaining.push(entry);
    }
    if (literals.length > 0 && remaining.length === 0) {
        return Object.assign(Object.assign({}, schema), { enum: literals, nullable, anyOf: undefined, oneOf: undefined });
    }
    if (remaining.length === 1) {
        return Object.assign(Object.assign({}, remaining[0]), { nullable, anyOf: undefined, oneOf: undefined, title: schema.title, description: schema.description });
    }
    return schema;
}
/** Infer a field type string from a raw config value (schema-less fallback) */
function inferFieldType(value) {
    if (value == null)
        return 'string';
    if (typeof value === 'boolean')
        return 'boolean';
    if (typeof value === 'number')
        return 'number';
    if (typeof value === 'string')
        return 'string';
    if (Array.isArray(value))
        return 'array';
    if (typeof value === 'object')
        return 'object';
    return 'string';
}
/** Collect all tags from a schema tree */
function extractSchemaTags(schema) {
    const tags = new Set();
    function walk(s) {
        var _a, _b;
        for (const t of ((_b = (_a = s['x-tags']) !== null && _a !== void 0 ? _a : s.tags) !== null && _b !== void 0 ? _b : [])) {
            if (typeof t === 'string')
                tags.add(t.toLowerCase());
        }
        if (s.properties) {
            for (const child of Object.values(s.properties))
                walk(child);
        }
        if (s.items && !Array.isArray(s.items))
            walk(s.items);
    }
    walk(schema);
    return [...tags];
}
