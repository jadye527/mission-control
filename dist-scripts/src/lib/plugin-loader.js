"use strict";
/**
 * Plugin Loader
 *
 * Simple explicit loader following the initPro() pattern.
 * Plugins register via direct import + init() call.
 *
 * Dynamic MC_PLUGINS env-based loading can be added later.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPlugins = loadPlugins;
function loadPlugins() {
    // Plugins register via direct import + init() call.
    // Example:
    //   import { initHyperbrowserPlugin } from '@/plugins/hyperbrowser'
    //   initHyperbrowserPlugin()
}
