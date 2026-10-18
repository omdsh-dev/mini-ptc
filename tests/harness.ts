/* oxlint-disable eslint/no-magic-numbers -- Harness counters and fixture values are local test data. */
/* oxlint-disable unicorn/no-null -- A manual compaction event carries an explicit null turn. */
/* oxlint-disable typescript/no-unsafe-type-assertion -- The fake agent is the scope key itself; the registry only uses it as an object identity. */
/* oxlint-disable typescript/require-await -- Fixture tool bodies return already-resolved values. */
/* oxlint-disable eslint/prefer-template -- Generated call ids and fixture text are assembled from fragments. */
/* oxlint-disable eslint/new-cap -- ToolCallId is a stateless brand factory, not a constructor. */

/**
 * Shared real-Cordis harness: system prompt service, tool registry, a scoped
 * agent preset, and the in-process fake PTC runtime.
 *
 * @module mini-ptc/tests/harness
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

import type { PluginConfig } from '#src/index'
import { Config, apply, inject, name } from '#src/index'

import { FakePtcRuntime } from './fake-runtime.ts'

const plugin = { Config, apply, inject, name }

/** Options accepted by the harness. */
interface HarnessOptions {
  /** Partial plugin configuration; defaults are applied as in production. */
  config?: PluginConfig
}

/** Observable production composition used by the integration suites. */
interface PluginHarness {
  /** Root context carrying the host services. */
  ctx: Context
  /** The transport tool name resolved from config. */
  toolName: string
  /** Assemble the model-facing prompt for the harness agent scope. */
  assemble: () => Promise<PromptAssembly>
  /** Assemble the model-facing prompt for an unrelated native scope. */
  assembleOutside: () => Promise<PromptAssembly>
  /** Execute one transport program through the real tool pipeline. */
  run: (code: string, description?: string) => Promise<ToolExecutionResult>
  /** Execute one registered tool directly through the real pipeline. */
  call: (toolName: string, args?: unknown) => Promise<ToolExecutionResult>
  /** Execute one registered tool from an unrelated native scope. */
  callOutside: (
    toolName: string,
    args?: unknown,
  ) => Promise<ToolExecutionResult>
  /** Emit a successful compaction end for the harness agent's session. */
  emitCompaction: (sessionId?: string) => void
  /** Dispose only the plugin fiber so its registrations can be asserted removed. */
  disposePlugin: () => Promise<void>
  /** Dispose the plugin fiber and both scoped contexts. */
  dispose: () => Promise<void>
}

/** Register one deterministic fixture tool. */
function registerEcho(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'echo',
      description: 'Echo one string back. Useful for checking nested dispatch.',
      parameters: {
        text: { type: 'string', required: true, description: 'Text to echo.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args): Promise<string> {
        return args.text
      },
    }),
  )
}

/** Register a read-like fixture with several parameters. */
function registerReadFile(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'read_file',
      description: 'Read a file from disk and return its contents.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Absolute file path.',
        },
        offset: { type: 'number', description: 'First line offset.' },
        limit: { type: 'number', description: 'Maximum line count.' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      async execute(args): Promise<string> {
        return 'contents of ' + args.path
      },
    }),
  )
}

/**
 * Mount the host services, fixture tools, and the mini-ptc plugin on a parent
 * preset scope with a child agent scope.
 *
 * @param options - Optional plugin configuration.
 * @returns Harness with observable assembly and execution.
 */
export async function createPluginHarness(
  options: HarnessOptions = {},
): Promise<PluginHarness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(FakePtcRuntime)

  registerEcho(ctx)
  registerReadFile(ctx)
  ctx.systemPrompt.section({
    name: 'tool:fixture',
    order: 1000,
    text: 'Fixture tool guidance that must not reach the mini-ptc prompt.',
  })

  const presetKey = {}
  const preset = createScope(ctx, presetKey)
  const fiber = await preset.ctx.plugin(plugin, options.config ?? {})

  const agentKey = { session: { id: 'harness-agent' } }
  const agent = createScope(ctx, agentKey, { parent: presetKey })
  const outsideKey = { session: { id: 'harness-outside' } }
  const outside = createScope(ctx, outsideKey)
  const toolName = options.config?.toolName ?? 'run'
  let callCounter = 0

  const callWith = async (
    scopeKey: object,
    callName: string,
    args: unknown,
  ): Promise<ToolExecutionResult> => {
    callCounter += 1
    const result = await ctx.tools.execute({
      callId: ToolCallId('harness:' + String(callCounter)),
      name: callName,
      arguments: args,
      agent: scopeKey as unknown as Agent,
      signal: new AbortController().signal,
    })
    return result
  }

  const callAs = async (
    callName: string,
    args: unknown,
  ): Promise<ToolExecutionResult> => {
    const result = await callWith(agentKey, callName, args)
    return result
  }

  return {
    ctx,
    toolName,
    async assemble() {
      return ctx.systemPrompt.assemble({ scope: agentKey })
    },
    async assembleOutside() {
      return ctx.systemPrompt.assemble({ scope: outsideKey })
    },
    async run(code, description) {
      return callAs(toolName, {
        code,
        description: description ?? 'Harness program',
      })
    },
    async call(toolNameToCall, args) {
      return callAs(toolNameToCall, args ?? {})
    },
    async callOutside(toolNameToCall, args) {
      return callWith(outsideKey, toolNameToCall, args ?? {})
    },
    emitCompaction(sessionId = 'harness-agent') {
      const session = { id: sessionId } as unknown as Session
      const event = {
        type: 'compaction/end',
        seq: 1,
        time: Date.now(),
        data: { compactionId: 'harness-compaction', turn: null },
      } as unknown as SessionEvent
      agent.ctx.emit('session/event', session, event)
    },
    async disposePlugin() {
      await fiber.dispose()
    },
    async dispose() {
      await fiber.dispose()
      await agent.dispose()
      await outside.dispose()
      await preset.dispose()
    },
  }
}
