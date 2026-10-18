/* oxlint-disable eslint/class-methods-use-this, eslint/max-classes-per-file, eslint/new-cap, eslint/no-empty-function -- Small reflective test double. */
/* oxlint-disable eslint/prefer-template -- The strict-mode prefix is assembled onto generated source. */
/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-type-assertion -- JSON/Console/AsyncFunction bridge in a test double. */
/* oxlint-disable unicorn/custom-error-definition, unicorn/no-null -- The rejection class receives its name from the descriptor; PtcRunSpec requires null. */

/**
 * In-process PTC runtime used by the integration harness. It executes the
 * program in the current Node process with the declared binding namespaces and
 * error classes, mirroring the seam's function-body contract. It is
 * deliberately not a sandbox: the production provider is
 *
 * @module mini-ptc/tests/fake-runtime
 * @deepseek-ai/dsh-ptc-runtime-node.
 */

import { PtcRuntime } from '@deepseek-ai/dsh-ptc-runtime'
import type {
  PtcJsonValue,
  PtcRunRequest,
  PtcRunResult,
  PtcRunSpec,
} from '@deepseek-ai/dsh-ptc-runtime'

type BindingError = new (memberName: string, message: string) => Error

function buildErrorClass(
  namespace: PtcRunRequest['bindings'][number],
): BindingError | undefined {
  const descriptor = namespace.errorClass
  if (descriptor === undefined) {
    return undefined
  }
  const errorName = descriptor.name
  const member = descriptor.memberNameProperty
  return class FakeBindingError extends Error {
    public constructor(memberName: string, message: string) {
      super(message)
      this.name = errorName
      Object.defineProperty(this, member, {
        value: memberName,
        enumerable: true,
      })
    }
  }
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') {
    return arg
  }
  const serialized = JSON.stringify(arg)
  if (serialized === undefined) {
    return ''
  }
  return serialized
}

function makeConsole(logs: string[]): Console {
  const write = (...args: unknown[]): void => {
    logs.push(args.map((arg) => formatArg(arg)).join(' '))
  }
  return {
    log: write,
    info: write,
    warn: write,
    error: write,
    debug: write,
  } as unknown as Console
}

export class FakePtcRuntime extends PtcRuntime {
  public readonly language = 'typescript'
  public readonly isolation = 'process'

  public resolve(request: PtcRunRequest): PtcRunSpec {
    return {
      ...request,
      cwd: request.cwd ?? process.cwd(),
      timeoutMs: request.timeoutMs ?? null,
    }
  }

  public async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    if (spec.signal !== undefined && spec.signal.aborted) {
      return { logs: [], error: { kind: 'abort', message: 'program aborted' } }
    }

    const logs: string[] = []
    const errorClasses = spec.bindings.map((namespace) =>
      buildErrorClass(namespace),
    )
    const namespaces = spec.bindings.map((namespace, index) => {
      const errorClass = errorClasses[index]
      const members: Record<string, unknown> = Object.create(null)
      for (const [name, fn] of Object.entries(namespace.functions)) {
        members[name] = async (args: unknown): Promise<PtcJsonValue> => {
          try {
            return await fn(args)
          } catch (error) {
            let message = String(error)
            if (error instanceof Error) {
              const { message: detail } = error
              message = detail
            }
            if (errorClass === undefined) {
              throw error
            }
            throw new errorClass(name, message)
          }
        }
      }
      return members
    })

    const parameters: string[] = spec.bindings.map(
      (namespace) => namespace.global,
    )
    const values: unknown[] = [...namespaces]
    for (const [index, errorClass] of errorClasses.entries()) {
      const descriptor = spec.bindings[index]?.errorClass
      if (errorClass !== undefined && descriptor !== undefined) {
        parameters.push(descriptor.name)
        values.push(errorClass)
      }
    }
    parameters.push('console')
    values.push(makeConsole(logs))

    try {
      const AsyncFunction = (async (): Promise<void> => {}).constructor as new (
        ...args: string[]
      ) => (...values: unknown[]) => Promise<unknown>
      const result = await new AsyncFunction(
        ...parameters,
        "'use strict';\n" + spec.program,
      )(...values)
      if (result === undefined) {
        return { logs }
      }
      const clone = structuredClone(result) as PtcJsonValue
      return { logs, value: clone }
    } catch (error) {
      let message = String(error)
      if (error instanceof Error) {
        const { message: detail } = error
        message = detail
      }
      return { logs, error: { kind: 'exception', message } }
    }
  }
}
