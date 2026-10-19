import type { Context } from '@deepseek-ai/cordis'
import type {
  PtcRunResult,
  PtcRunSpec,
  PtcRuntime,
} from '@deepseek-ai/dsh-ptc-runtime'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {
  ToolExecutionFailure,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'

import { createPluginHarness } from './harness.ts'

/** Narrow a successful tool result to its rendered value. */
function valueOf(result: ToolExecutionResult): string {
  if (result.isError) {
    throw new TypeError(result.error.message)
  }
  const { value } = result
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value) ?? ''
}

/** Narrow a failed tool result without putting a conditional in a test body. */
function failureOf(result: ToolExecutionResult): ToolExecutionFailure {
  if (!result.isError) {
    throw new TypeError('expected a failed tool result')
  }
  return result
}

/** Read the mounted PTC runtime without a conditional inside a test body. */
function runtimeOf(ctx: Context): PtcRuntime {
  const runtime = ctx.get('ptcRuntime')
  if (runtime === undefined) {
    throw new TypeError('harness is missing its PTC runtime')
  }
  return runtime
}

describe('mini-ptc first-run discovery', () => {
  it('requires exact help-only source in the first program', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ primeHelp: false })
    try {
      const blocked = failureOf(
        await harness.run('return await tools.echo({ text: "blocked" })'),
      )
      expect(blocked.error.message).toContain('must be exactly')

      const extra = failureOf(await harness.run('await help()\nreturn "extra"'))
      expect(extra.error.message).toContain('must be exactly')

      const listed = valueOf(await harness.run('return await help()'))
      expect(listed).toContain('echo')

      const echoed = valueOf(
        await harness.run('return await tools.echo({ text: "allowed" })'),
      )
      expect(echoed).toBe('"allowed"')
    } finally {
      await harness.dispose()
    }
  })

  it('rejects other source after help in the first program', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ primeHelp: false })
    try {
      const violation = failureOf(
        await harness.run(
          'await help()\nawait tools.echo({ text: "too early" })',
        ),
      )
      expect(violation.error.message).toContain('must be exactly')

      const blocked = failureOf(
        await harness.run('return await tools.echo({ text: "still blocked" })'),
      )
      expect(blocked.error.message).toContain('must be exactly')

      const listed = valueOf(await harness.run('return await help()'))
      expect(listed).toContain('echo')

      const echoed = valueOf(
        await harness.run('return await tools.echo({ text: "ok" })'),
      )
      expect(echoed).toBe('"ok"')
    } finally {
      await harness.dispose()
    }
  })

  it('does not count a failed first discovery', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ primeHelp: false })
    try {
      const runtime = runtimeOf(harness.ctx)
      const originalRun = runtime.run.bind(runtime)
      const spy = vi
        .spyOn(runtime, 'run')
        .mockImplementationOnce(
          async (spec: PtcRunSpec): Promise<PtcRunResult> => {
            const result = await originalRun(spec)
            return {
              logs: result.logs,
              error: { kind: 'exception', message: 'forced discovery failure' },
            }
          },
        )
      try {
        const failed = failureOf(await harness.run('return await help()'))
        expect(failed.error.message).toContain('forced discovery failure')
      } finally {
        spy.mockRestore()
      }

      const blocked = failureOf(
        await harness.run('return await tools.echo({ text: "blocked" })'),
      )
      expect(blocked.error.message).toContain('must be exactly')

      const listed = valueOf(await harness.run('return await help()'))
      expect(listed).toContain('echo')

      const echoed = valueOf(
        await harness.run('return await tools.echo({ text: "ok" })'),
      )
      expect(echoed).toBe('"ok"')
    } finally {
      await harness.dispose()
    }
  })

  it('rejects a first program whose help call never executes', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ primeHelp: false })
    try {
      const fake = failureOf(
        await harness.run('// help()\nreturn "no discovery"'),
      )
      expect(fake.error.message).toContain('must be exactly')

      const blocked = failureOf(
        await harness.run('return await tools.echo({ text: "blocked" })'),
      )
      expect(blocked.error.message).toContain('must be exactly')
    } finally {
      await harness.dispose()
    }
  })
})

describe('mini-ptc first-run commits', () => {
  it('commits the exact help pin from the first program', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ primeHelp: false })
    try {
      const listed = valueOf(
        await harness.run('return await help("read_file")'),
      )
      expect(listed).toContain('Tool: read_file')

      const assembly = await harness.assemble()
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('Tool: read_file')

      const echoed = valueOf(
        await harness.run('return await tools.echo({ text: "ok" })'),
      )
      expect(echoed).toBe('"ok"')
    } finally {
      await harness.dispose()
    }
  })
})
