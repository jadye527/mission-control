"use strict";
/**
 * Plugin Registry
 *
 * Module-scoped registries following the existing register*() pattern
 * (see registerAuthResolver in auth.ts, registerMigrations in migrations.ts).
 *
 * Plugins call register* functions at init time to extend integrations,
 * categories, nav items, panels, and tool providers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerIntegrations = registerIntegrations;
exports.getPluginIntegrations = getPluginIntegrations;
exports.registerCategories = registerCategories;
exports.getPluginCategories = getPluginCategories;
exports.registerNavItems = registerNavItems;
exports.getPluginNavItems = getPluginNavItems;
exports.registerPanel = registerPanel;
exports.getPluginPanel = getPluginPanel;
exports.getPluginPanelIds = getPluginPanelIds;
exports.registerToolProviders = registerToolProviders;
exports.getPluginToolProviders = getPluginToolProviders;
// ---------------------------------------------------------------------------
// Registries (module-scoped)
// ---------------------------------------------------------------------------
const _integrations = [];
const _categories = [];
const _navItems = [];
const _panels = new Map();
const _toolProviders = [];
// ---------------------------------------------------------------------------
// Integration registry
// ---------------------------------------------------------------------------
function registerIntegrations(defs) {
    _integrations.push(...defs);
}
function getPluginIntegrations() {
    return _integrations;
}
// ---------------------------------------------------------------------------
// Category registry
// ---------------------------------------------------------------------------
function registerCategories(cats) {
    _categories.push(...cats);
}
function getPluginCategories() {
    return _categories;
}
// ---------------------------------------------------------------------------
// Nav item registry
// ---------------------------------------------------------------------------
function registerNavItems(items) {
    _navItems.push(...items);
}
function getPluginNavItems() {
    return _navItems;
}
// ---------------------------------------------------------------------------
// Panel registry
// ---------------------------------------------------------------------------
function registerPanel(id, component) {
    _panels.set(id, component);
}
function getPluginPanel(id) {
    return _panels.get(id);
}
function getPluginPanelIds() {
    return Array.from(_panels.keys());
}
// ---------------------------------------------------------------------------
// Tool provider registry
// ---------------------------------------------------------------------------
function registerToolProviders(provs) {
    _toolProviders.push(...provs);
}
function getPluginToolProviders() {
    return _toolProviders;
}
