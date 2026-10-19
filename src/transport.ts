/* oxlint-disable eslint/prefer-template -- Generated strings are assembled from fragments for readability. */

/**
 * The single native-facing transport tool. It executes a TypeScript program in
 * the host PTC runtime and formats the result for the model.
 *
 * @module mini-ptc/transport
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  PtcBindingFunction,
  PtcJsonValue,
  PtcRunRequest,
  PtcRunResult,
  PtcRunSpec,
  PtcRuntime,
} from '@deepseek-ai/dsh-ptc-runtime'
import type { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'

import {
  ERROR_CLASS,
  ERROR_MEMBER,
  FIRST_PROGRAM_ONLY_HELP,
  TOOLS_GLOBAL,
  createToolBindings,
  renderPrelude,
} from './bindings.ts'
import type { ResolvedConfig } from './config.ts'
import { isOnlyHelpProgram } from './help.ts'
import type { PromptStateStore } from './prompt-state.ts'

const JSON_INDENT = 2
const EMPTY_OUTPUT = '(run completed with no output)'
const NO_SANDBOX: string | undefined = undefined
const NO_CWD: string | undefined = undefined
const NO_POLICY: PtcRunRequest['sandboxPolicy'] = undefined
const NONE = 0

function renderValue(value: PtcJsonValue): string {
  return JSON.stringify(value, undefined, JSON_INDENT) ?? '(unrenderable value)'
}

function renderSandbox(sandbox: PtcRunResult['sandbox']): string | undefined {
  if (sandbox === undefined) {
    return NO_SANDBOX
  }
  let enforcement = ''
  if (sandbox.enforcement !== undefined) {
    enforcement = '; enforcement: ' + sandbox.enforcement
  }
  let denied = ''
  if (sandbox.denied) {
    denied = '; operation denied'
  }
  return 'File sandbox: ' + sandbox.mode + enforcement + denied + '.'
}

function describeFailure(result: PtcRunResult): string {
  let logs = ''
  if (result.logs.length > NONE) {
    logs = '\nCaptured output:\n' + result.logs.join('\n')
  }
  const sandbox = renderSandbox(result.sandbox)
  let sandboxSuffix = ''
  if (sandbox !== undefined) {
    sandboxSuffix = '\n' + sandbox
  }
  if (result.error === undefined) {
    return 'run failed: ' + logs + sandboxSuffix
  }
  return (
    'run failed ('
    + result.error.kind
    + '): '
    + result.error.message
    + logs
    + sandboxSuffix
  )
}

function describeSuccess(result: PtcRunResult): string {
  const parts: string[] = []
  if (result.logs.length > NONE) {
    parts.push(result.logs.join('\n'))
  }
  if (result.value !== undefined) {
    parts.push(renderValue(result.value))
  }
  const sandbox = renderSandbox(result.sandbox)
  if (sandbox !== undefined) {
    parts.push(sandbox)
  }
  if (parts.length === NONE) {
    return EMPTY_OUTPUT
  }
  return parts.join('\n\n')
}

/** Options for one request construction. */
interface RequestOptions {
  runtime: PtcRuntime
  config: ResolvedConfig
  program: string
  timeoutMs: number | undefined
  cwd: string | undefined
  sandboxPolicy: PtcRunRequest['sandboxPolicy']
  functions: Record<string, PtcBindingFunction>
  signal: AbortSignal
}

function buildRequest(options: RequestOptions): PtcRunRequest {
  const {
    runtime,
    config,
    program,
    timeoutMs,
    cwd,
    sandboxPolicy,
    functions,
    signal,
  } = options
  const request: PtcRunRequest = {
    program,
    bindings: [
      {
        global: TOOLS_GLOBAL,
        functions,
        errorClass: { name: ERROR_CLASS, memberNameProperty: ERROR_MEMBER },
      },
    ],
    signal,
  }
  if (runtime.timeout !== undefined) {
    request.timeoutMs = Math.min(
      timeoutMs ?? config.timeoutMs,
      config.maxTimeoutMs,
    )
  }
  if (cwd !== undefined) {
    request.cwd = cwd
  }
  if (sandboxPolicy !== undefined) {
    request.sandboxPolicy = sandboxPolicy
  }
  return request
}

/** Options for one program execution. */
interface ExecuteOptions {
  ctx: Context
  config: ResolvedConfig
  runtime: PtcRuntime
  args: { code: string; timeoutMs?: number }
  exec: ToolRunContext
  promptState: PromptStateStore
}

/** Resolved session directory and file policy for one program. */
interface ExecutionContext {
  cwd: string | undefined
  sandboxPolicy: PtcRunRequest['sandboxPolicy']
}

/** Read the session directory through the optional host service. */
async function resolveCwd(
  directories: WorkingDirectoryService | undefined,
  exec: ToolRunContext,
): Promise<string | undefined> {
  if (directories === undefined || exec.agent === undefined) {
    return NO_CWD
  }
  const cwd = await directories.ensure(exec.agent, exec.signal)
  return cwd
}

/** Read the standing file policy through the optional host service. */
function resolvePolicy(
  policies: SandboxPolicyService | undefined,
  exec: ToolRunContext,
): PtcRunRequest['sandboxPolicy'] {
  if (policies === undefined) {
    return NO_POLICY
  }
  if (exec.agent === undefined) {
    return policies.resolve()
  }
  return policies.resolve({ session: exec.agent.session })
}

/** Resolve the calling session's directory and standing sandbox policy. */
async function resolveExecutionContext(
  ctx: Context,
  exec: ToolRunContext,
): Promise<ExecutionContext> {
  const directories: WorkingDirectoryService | undefined =
    ctx.get('workingDirectory')
  const policies: SandboxPolicyService | undefined = ctx.get('sandboxPolicy')
  const cwd = await resolveCwd(directories, exec)
  const sandboxPolicy = resolvePolicy(policies, exec)
  return { cwd, sandboxPolicy }
}

async function executeProgram(options: ExecuteOptions): Promise<string> {
  const { ctx, config, runtime, args, exec, promptState } = options
  const sessionId = exec.agent?.session.id
  const firstProgram =
    sessionId !== undefined && !promptState.hasCalledHelp(sessionId)
  if (firstProgram && !isOnlyHelpProgram(args.code)) {
    throw new Error(
      'the first program in this session must be exactly "return await help()" or "await help()"; the program was not executed',
    )
  }
  const controller = new AbortController()
  const onAbort = (): void => {
    controller.abort(exec.signal.reason)
  }
  if (exec.signal.aborted) {
    controller.abort(exec.signal.reason)
  } else {
    exec.signal.addEventListener('abort', onAbort, { once: true })
  }

  const { cwd, sandboxPolicy } = await resolveExecutionContext(ctx, exec)
  const bindings = createToolBindings({
    ctx,
    config,
    exec,
    controller,
    promptState,
    firstProgram,
  })
  const { functions, pending, helpBindingName } = bindings
  try {
    const program = renderPrelude(helpBindingName) + args.code
    const request = buildRequest({
      runtime,
      config,
      program,
      timeoutMs: args.timeoutMs,
      cwd,
      sandboxPolicy,
      functions,
      signal: controller.signal,
    })
    const spec: PtcRunSpec = runtime.resolve(request)
    const result = await runtime.run(spec)
    if (result.error !== undefined) {
      throw new Error(describeFailure(result))
    }
    if (firstProgram && sessionId !== undefined) {
      if (bindings.firstProgramViolated()) {
        throw new Error(FIRST_PROGRAM_ONLY_HELP)
      }
      if (!bindings.helpCalled()) {
        throw new Error(
          'the first program in this session must be exactly one help() call; discovery was not recorded',
        )
      }
      promptState.markHelpCalled(sessionId)
      for (const doc of bindings.pendingExact()) {
        promptState.pin(sessionId, doc)
      }
    }
    return describeSuccess(result)
  } finally {
    exec.signal.removeEventListener('abort', onAbort)
    controller.abort('program settled')
    await Promise.allSettled(pending)
  }
}

/** Inputs for one transport tool definition. */
interface RunToolOptions {
  ctx: Context
  config: ResolvedConfig
  runtime: PtcRuntime
  promptState: PromptStateStore
}

/**
 * Build the transport tool definition.
 *
 * @param options - Scoped context, config, runtime, and prompt state.
 * @returns A registry-ready tool definition.
 */
function createRunTool(options: RunToolOptions): ToolDefinition {
  const { ctx, config, runtime, promptState } = options
  const instructions = runtime.executionInstructions
  const description = [
    'Execute a TypeScript program against the available tools. Call await help() inside the program to list tools and await help("name") for one tool\'s full schema. The first run in each session must be exactly "return await help()" or "await help()" (an optional string name is allowed); any other source is rejected before execution, and discovery is recorded only after the run succeeds.',
    instructions,
  ]
    .filter((part) => part.length > NONE)
    .join(' ')

  return defineTool({
    name: config.toolName,
    description,
    parameters: {
      code: {
        type: 'string',
        required: true,
        description: 'The program: the body of an async TypeScript function.',
      },
      description: {
        type: 'string',
        required: true,
        description:
          'Clear, concise description of what this program does, in the language of the request.',
      },
      timeoutMs: {
        type: 'number',
        description:
          'Optional positive elapsed-time budget in milliseconds. Defaults to '
          + String(config.timeoutMs)
          + '; capped by the runtime.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: args.description,
      kind: 'execute',
      rawInput: args.code,
    }),
    async execute(args, exec) {
      const output = await executeProgram({
        ctx,
        config,
        runtime,
        args,
        exec,
        promptState,
      })
      return output
    },
  })
}

export { createRunTool }
