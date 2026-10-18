/**
 * Serializable configuration, validation, and direct-call defaults.
 *
 * @module mini-ptc/config
 */

import schema from '@deepseek-ai/schemastery'

/** Tool name reserved by the host PTC transport. */
const RESERVED_TRANSPORT = 'run_code'

/** Tool name reserved for the in-program discovery function. */
const HELP_NAME = 'help'

const DEFAULT_TOOL_NAME = 'run'
const DEFAULT_TIMEOUT_MS = 120_000
const MIN_TIMEOUT_MS = 1
const DEFAULT_MAX_TIMEOUT_MS = 600_000

/** Plugin configuration supplied by the profile composition. */
interface PluginConfig {
  /** Name of the single directly callable transport tool. */
  toolName?: string
  /** Default elapsed-time budget for one program, in milliseconds. */
  timeoutMs?: number
  /** Deployment cap for an explicit program budget, in milliseconds. */
  maxTimeoutMs?: number
}

/** Loader-visible configuration schema and defaults. */
const Config: schema<PluginConfig> = schema.object({
  toolName: schema.string().default(DEFAULT_TOOL_NAME),
  timeoutMs: schema.natural().min(MIN_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS),
  maxTimeoutMs: schema
    .natural()
    .min(MIN_TIMEOUT_MS)
    .default(DEFAULT_MAX_TIMEOUT_MS),
})

/** Configuration after defaults have been resolved and validated. */
interface ResolvedConfig {
  toolName: string
  timeoutMs: number
  maxTimeoutMs: number
}

/** One transport name accepted by the loader. */
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/u

/**
 * Resolve the same defaults for direct callers that bypass Cordis Loader.
 *
 * @param config - Partial serialized configuration.
 * @returns Configuration with all defaults applied and invariants checked.
 */
function resolveConfig(config: PluginConfig = {}): ResolvedConfig {
  const toolName = config.toolName ?? DEFAULT_TOOL_NAME
  if (!TOOL_NAME_PATTERN.test(toolName)) {
    throw new Error(
      `mini-ptc: toolName ${JSON.stringify(toolName)} is not a valid tool identifier`,
    )
  }
  if (toolName === RESERVED_TRANSPORT) {
    throw new Error(
      `mini-ptc: toolName "run_code" is reserved by the host PTC transport`,
    )
  }
  if (toolName === HELP_NAME) {
    throw new Error(
      'mini-ptc: toolName "help" is reserved for the in-program help function',
    )
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxTimeoutMs = config.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS) {
    throw new Error('mini-ptc: timeoutMs must be a positive integer')
  }
  if (!Number.isInteger(maxTimeoutMs) || maxTimeoutMs < timeoutMs) {
    throw new Error(
      'mini-ptc: maxTimeoutMs must be an integer greater than or equal to timeoutMs',
    )
  }

  return { toolName, timeoutMs, maxTimeoutMs }
}

export { Config, resolveConfig, type PluginConfig, type ResolvedConfig }
