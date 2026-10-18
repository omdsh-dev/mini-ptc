/**
 * Runtime boundary and Cordis activation for the mini PTC preset.
 *
 * @module mini-ptc/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
/* oxlint-disable import/no-empty-named-blocks, unicorn/require-module-specifiers -- Type-only import activates the compaction session-event declarations. */
import type {} from '@deepseek-ai/dsh-compaction'
/* oxlint-enable import/no-empty-named-blocks, unicorn/require-module-specifiers */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

import type { PluginConfig } from './config.ts'
import { resolveConfig } from './config.ts'
import { PromptStateStore, sessionIdOfScope } from './prompt-state.ts'
import { renderPrompt } from './prompt.ts'
import { createRunTool } from './transport.ts'

/** Explicit allow result for the monotonic guard's string-or-undefined contract. */
const ALLOW: string | undefined = undefined

/** Whether one session event completed a compaction without an error. */
function isSuccessfulCompactionEnd(event: SessionEvent): boolean {
  if (event.type !== 'compaction/end') {
    return false
  }
  return event.data.error === undefined
}

/**
 * Apply the plugin to its Cordis context.
 *
 * @param ctx - Agent-scoped context owned by the preset mount.
 * @param config - Configuration resolved by Cordis from the exported schema.
 */
function apply(ctx: Context, config: PluginConfig): void {
  const resolved = resolveConfig(config)
  const runtime = ctx.ptcRuntime
  if (runtime.language !== 'typescript') {
    throw new Error(
      `mini-ptc: requires a TypeScript PTC runtime, got ${JSON.stringify(runtime.language)}`,
    )
  }
  if (runtime.programFormat !== 'function-body') {
    throw new Error(
      `mini-ptc: requires a function-body PTC runtime, got ${JSON.stringify(runtime.programFormat)}`,
    )
  }

  // Keep the transport native to the registry: the model never sees a generated
  // SDK, and the scoped presentation cannot inherit a deployment-wide ptc mode.
  ctx.tools.presentAs('native')

  const promptState = new PromptStateStore()
  ctx.on('session/event', (session, event) => {
    if (isSuccessfulCompactionEnd(event)) {
      promptState.compact(session.id)
    }
  })
  ctx.on('session/disposed', (session) => {
    promptState.delete(session.id)
  })
  ctx.effect((): (() => void) => (): void => {
    promptState.clear()
  })

  ctx.systemPrompt.section({
    name: 'mini-ptc:help',
    order: ctx.systemPrompt.getSectionOrder('TOOLS_SDK'),
    interpolate: false,
    text: (context) => {
      const sessionId = sessionIdOfScope(context.scope)
      if (sessionId === undefined) {
        return renderPrompt(resolved.toolName, [])
      }
      return renderPrompt(resolved.toolName, promptState.docsFor(sessionId))
    },
  })

  // oxlint-disable-next-line typescript/promise-function-async -- Cordis waterfall listeners return the downstream promise directly.
  ctx.on('system-prompt/assemble', (assembly, context, next) => {
    const transport = ctx.tools
      .schemas(context.scope)
      .find((schema) => schema.name === resolved.toolName)
    assembly.sections = assembly.sections.filter(
      (section) =>
        // Drop generated SDK and tool-guidance sections; help() replaces them.
        !section.name.startsWith('tools:')
        && !section.name.startsWith('tool:')
        && !section.name.startsWith('mcp:'),
    )
    if (transport === undefined) {
      assembly.tools = []
    } else {
      assembly.tools = [transport]
    }
    return next()
  })

  ctx.tools.guard((exec) => {
    if (exec.parent !== undefined) {
      return ALLOW
    }
    if (exec.name === resolved.toolName) {
      return ALLOW
    }
    return `only ${resolved.toolName} is callable directly — call tools from inside a ${resolved.toolName} program; help() lists them`
  })

  ctx.tools.register(
    createRunTool({
      ctx,
      config: resolved,
      runtime,
      promptState,
    }),
  )
}

export { apply }
