/* oxlint-disable eslint/no-magic-numbers -- Dispatch counters and one-line probes are local to the bridge. */
/* oxlint-disable eslint/prefer-template -- Generated strings are assembled from fragments for readability. */

/**
 * Per-program tool bindings for the mini PTC transport. Builds the tools
 * namespace, the hidden help member, and the serialized nested-dispatch gate.
 *
 * @module mini-ptc/bindings
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {
  PtcBindingFunction,
  PtcJsonValue,
} from '@deepseek-ai/dsh-ptc-runtime'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { ResolvedConfig } from './config.ts'
import { resolveHelp } from './help.ts'
import type { ToolDoc } from './help.ts'
import type { PromptStateStore } from './prompt-state.ts'

/** The registry input shape for one nested dispatch. */
type ExecuteInput = Parameters<Context['tools']['execute']>[0]

/** The agent object carried by one execution, when the caller has one. */
type ExecutionAgent = NonNullable<ExecuteInput['agent']>

/** The binding namespace the generated program sees. */
const TOOLS_GLOBAL = 'tools'

/** The rejection class installed for failed binding calls. */
const ERROR_CLASS = 'ToolCallError'

/** The property that identifies the failing binding. */
const ERROR_MEMBER = 'toolName'

/** The natural help binding name. */
const HELP_NAME = 'help'

/** A collision-safe fallback when a tool is literally named help. */
const FALLBACK_HELP_NAME = '__mini_help'

/** Separator between the outer call id and the nested dispatch counter. */
const CALL_ID_SEPARATOR = ':mini:'

/** No query was supplied to help(). */
const NO_QUERY = ''

/** Rejection for a first program that attempts any tool call besides help(). */
const FIRST_PROGRAM_ONLY_HELP =
  'the first program in this session must be exactly one help() call; other tool calls are not allowed'

/** The run-scoped prelude that exposes a bare help() to user programs. */
function renderPrelude(helpBindingName: string): string {
  const access = 'tools[' + JSON.stringify(helpBindingName) + ']'
  return [
    'globalThis.help = async (name) => {',
    '  const text = await ' + access + '(name === undefined ? {} : { name })',
    '  console.log(text)',
    '  return text',
    '}',
    '',
  ].join('\n')
}

/** Pick a tools-namespace key that cannot shadow a registered tool. */
function pickHelpBindingName(schemas: readonly ToolSchema[]): string {
  const taken = new Set(schemas.map((schema) => schema.name))
  if (!taken.has(HELP_NAME)) {
    return HELP_NAME
  }
  let suffix = 0
  let candidate = FALLBACK_HELP_NAME
  while (taken.has(candidate)) {
    suffix += 1
    candidate = FALLBACK_HELP_NAME + '_' + String(suffix)
  }
  return candidate
}

/** Collect the live documentation for every visible tool except the transport. */
function buildToolDocs(
  ctx: Context,
  scope: object | undefined,
  transportName: string,
): ToolDoc[] {
  const docs: ToolDoc[] = []
  for (const schema of ctx.tools.schemas(scope)) {
    if (schema.name !== transportName) {
      const definition = ctx.tools.get(schema.name, scope)
      docs.push({
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
        output: definition?.output.schema,
      })
    }
  }
  return docs.toSorted((left, right) => left.name.localeCompare(right.name))
}

/**
 * Read the optional query from one help binding call without trusting its
 * shape.
 */
function readHelpQuery(rawArgs: unknown): string {
  if (typeof rawArgs !== 'object' || rawArgs === null || !('name' in rawArgs)) {
    return NO_QUERY
  }
  const value = rawArgs.name
  if (typeof value === 'string') {
    return value
  }
  return NO_QUERY
}

/** Serialize nested tool calls while preserving caller order. */
interface SerialGate {
  run: <Value>(work: () => Promise<Value>) => Promise<Value>
}

/** Create the one-at-a-time dispatch gate for a single program. */
function createSerialGate(): SerialGate {
  let tail: Promise<boolean> = Promise.resolve(true)
  return {
    async run<Value>(work: () => Promise<Value>): Promise<Value> {
      const previous = tail
      const gate = Promise.withResolvers<boolean>()
      tail = gate.promise
      await previous
      try {
        return await work()
      } finally {
        gate.resolve(true)
      }
    },
  }
}

/** Add the optional agent field without a conditional spread in the literal. */
function withAgent(
  input: ExecuteInput,
  agent: ExecutionAgent | undefined,
): ExecuteInput {
  if (agent === undefined) {
    return input
  }
  return { ...input, agent }
}

/** Options accepted by the binding factory. */
interface BindingOptions {
  ctx: Context
  config: ResolvedConfig
  exec: ToolRunContext
  controller: AbortController
  promptState: PromptStateStore
  firstProgram: boolean
}

/** The constructed namespace plus the tasks and state the caller must commit. */
interface BindingSet {
  functions: Record<string, PtcBindingFunction>
  pending: Set<Promise<PtcJsonValue>>
  helpBindingName: string
  helpCalled: () => boolean
  pendingExact: () => readonly ToolDoc[]
  firstProgramViolated: () => boolean
}

/** Build the tools namespace and its help member for one program. */
function createToolBindings(options: BindingOptions): BindingSet {
  const { ctx, config, exec, controller, promptState, firstProgram } = options
  const schemas = ctx.tools.schemas(exec.agent)
  const docs = buildToolDocs(ctx, exec.agent, config.toolName)
  const docsByName = new Map<string, ToolDoc>(
    docs.map((doc) => [doc.name, doc]),
  )
  const helpBindingName = pickHelpBindingName(schemas)
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- A null-prototype namespace is required for exotic tool names.
  const functions: Record<string, PtcBindingFunction> = Object.create(null)
  const pending = new Set<Promise<PtcJsonValue>>()
  const gate = createSerialGate()
  let dispatchCount = 0
  let helpCalled = false
  const pendingExact: ToolDoc[] = []
  let firstProgramViolated = false

  const dispatch = async (
    schema: ToolSchema,
    rawArgs: unknown,
  ): Promise<PtcJsonValue> => {
    if (controller.signal.aborted) {
      throw new Error(
        'the program is aborted; ' + schema.name + ' was not dispatched',
      )
    }
    if (firstProgram) {
      firstProgramViolated = true
      throw new Error(FIRST_PROGRAM_ONLY_HELP)
    }
    const doc = docsByName.get(schema.name)
    if (exec.agent !== undefined && doc !== undefined) {
      promptState.recordUse(exec.agent.session.id, doc)
    }
    dispatchCount += 1
    // oxlint-disable-next-line eslint/new-cap -- ToolCallId is a stateless brand factory, not a constructor.
    const callId = ToolCallId(
      String(exec.callId) + CALL_ID_SEPARATOR + String(dispatchCount),
    )
    const outcome = await ctx.tools.execute(
      withAgent(
        {
          callId,
          rootCallId: exec.rootCallId,
          name: schema.name,
          schema,
          arguments: rawArgs,
          parent: exec.token,
          signal: controller.signal,
        },
        exec.agent,
      ),
    )
    if (outcome.isError) {
      throw new TypeError(outcome.error.message)
    }
    return outcome.value
  }

  const bind =
    (schema: ToolSchema): PtcBindingFunction =>
    async (rawArgs) => {
      // oxlint-disable-next-line typescript/promise-function-async -- The gate callback returns the dispatch promise unchanged.
      const task = gate.run(() => dispatch(schema, rawArgs))
      pending.add(task)
      try {
        return await task
      } finally {
        pending.delete(task)
      }
    }

  for (const schema of schemas) {
    if (schema.name !== config.toolName) {
      functions[schema.name] = bind(schema)
    }
  }

  // oxlint-disable-next-line typescript/require-await -- PtcBindingFunction is async by contract.
  functions[helpBindingName] = async (rawArgs): Promise<PtcJsonValue> => {
    const resolution = resolveHelp(docs, readHelpQuery(rawArgs))
    helpCalled = true
    if (exec.agent !== undefined && resolution.exact !== undefined) {
      if (firstProgram) {
        pendingExact.push(resolution.exact)
      } else {
        promptState.pin(exec.agent.session.id, resolution.exact)
      }
    }
    return resolution.text
  }

  return {
    functions,
    pending,
    helpBindingName,
    helpCalled: () => helpCalled,
    pendingExact: () => pendingExact,
    firstProgramViolated: () => firstProgramViolated,
  }
}

export {
  CALL_ID_SEPARATOR,
  ERROR_CLASS,
  ERROR_MEMBER,
  FIRST_PROGRAM_ONLY_HELP,
  TOOLS_GLOBAL,
  buildToolDocs,
  createSerialGate,
  createToolBindings,
  pickHelpBindingName,
  readHelpQuery,
  renderPrelude,
  withAgent,
  type BindingOptions,
  type BindingSet,
  type ExecuteInput,
  type ExecutionAgent,
}
