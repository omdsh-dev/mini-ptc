/**
 * Standalone function plugin for the mini PTC agent preset.
 *
 * @module mini-ptc
 */

/** Cordis plugin name; keep this stable after publishing. */
const name = 'mini-ptc'

/** Host services that must exist before the preset can mount. */
const inject = ['tools', 'systemPrompt', 'ptcRuntime']

export { Config } from './config.ts'
export type { PluginConfig, ResolvedConfig } from './config.ts'
export { apply } from './runtime.ts'
export { inject, name }
