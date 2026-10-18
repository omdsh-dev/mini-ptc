/* oxlint-disable eslint/no-magic-numbers -- Catalog markers and call counts use literal expected values. */
/* oxlint-disable vitest/max-expects -- Contract tests assert related prompt and dispatch facts together. */
/* oxlint-disable vitest/prefer-to-be-truthy, vitest/prefer-to-be-falsy -- Strict boolean matchers are required by prefer-strict-boolean-matchers. */

import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {
  ToolExecutionFailure,
  ToolExecutionResult,
} from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

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

describe('mini-ptc prompt composition', () => {
  it('replaces the native catalog with the compact help prompt', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const assembly = await harness.assemble()
      expect(assembly.tools.map((tool) => tool.name)).toStrictEqual(['run'])
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('## Tool access with help()')
      expect(prompt).toContain('Only \u0060run\u0060 can be called directly.')
      expect(prompt).not.toContain('ToolArgsMap')
      expect(prompt).not.toContain('Program-only SDK bindings')
      expect(prompt).not.toContain('Fixture tool guidance')
      expect(prompt).not.toContain('read_file')
    } finally {
      await harness.dispose()
    }
  })

  it('keeps the transport and guard inside its preset scope', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const assembly = await harness.assembleOutside()
      expect(assembly.tools.map((tool) => tool.name)).toContain('echo')
      expect(renderPrompt(assembly)).not.toContain('## Tool access with help()')

      const echoed = await harness.callOutside('echo', { text: 'outside' })
      expect(echoed.isError).toBe(false)
    } finally {
      await harness.dispose()
    }
  })

  it('honors a configured transport name', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness({ config: { toolName: 'exec' } })
    try {
      const assembly = await harness.assemble()
      expect(assembly.tools.map((tool) => tool.name)).toStrictEqual(['exec'])
      expect(renderPrompt(assembly)).toContain(
        'Only \u0060exec\u0060 can be called directly.',
      )
      expect(valueOf(await harness.run('return await help()'))).toContain(
        'echo',
      )
    } finally {
      await harness.dispose()
    }
  })

  it('removes every registration when the plugin fiber disposes', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      await harness.disposePlugin()

      const assembly = await harness.assemble()
      expect(assembly.tools.map((tool) => tool.name).toSorted()).toStrictEqual([
        'echo',
        'read_file',
      ])
      expect(renderPrompt(assembly)).not.toContain('## Tool access with help()')

      const echoed = await harness.call('echo', { text: 'after dispose' })
      expect(echoed.isError).toBe(false)
    } finally {
      await harness.dispose()
    }
  })
})

describe('mini-ptc execution', () => {
  it('lists tools through help() without the transport', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const listed = valueOf(await harness.run('return await help()'))
      expect(listed.startsWith('echo\nread_file')).toBe(true)
      expect(listed).not.toContain(' - ')
    } finally {
      await harness.dispose()
    }
  })

  it('returns full details for a known tool and a fuzzy typo', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const exact = valueOf(await harness.run('return await help("read_file")'))
      expect(exact).toContain('Tool: read_file')
      expect(exact).toContain('Parameters:')
      expect(exact).toContain('"path"')

      const assembly = await harness.assemble()
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('## Included tool reference')
      expect(prompt).toContain('Tool: read_file')
      expect(prompt).toContain(
        'Description: Read a file from disk and return its contents.',
      )

      const fuzzy = valueOf(await harness.run('return await help("reed_file")'))
      expect(fuzzy).toContain(
        'read_file - Read a file from disk and return its contents.',
      )
      expect(fuzzy).not.toContain('Parameters:')
    } finally {
      await harness.dispose()
    }
  })

  it('falls back to the same catalog when a query does not match', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const same = valueOf(
        await harness.run(
          [
            'const all = await help()',
            'const miss = await help("zzz-not-a-tool")',
            'return all === miss',
          ].join('\n'),
        ),
      )
      // Help() also prints, so the same name list appears twice before the return value.
      expect(same.split('echo\nread_file')).toHaveLength(3)
      expect(same.endsWith('true')).toBe(true)
    } finally {
      await harness.dispose()
    }
  })

  it('adds the most-used tools after a compaction', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      await harness.run('return await tools.echo({ text: "a" })')
      await harness.run('return await tools.echo({ text: "b" })')
      await harness.run('return await tools.read_file({ path: "/x" })')

      harness.emitCompaction()
      const assembly = await harness.assemble()
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('## Included tool reference')
      expect(prompt).toContain('Tool: echo')
      expect(prompt).toContain('Tool: read_file')
      expect(prompt).toContain('Description: Echo one string back.')
    } finally {
      await harness.dispose()
    }
  })

  it('dispatches nested tools through the real registry pipeline', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const echoed = valueOf(
        await harness.run('return await tools.echo({ text: "hello" })'),
      )
      expect(echoed).toBe('"hello"')

      const failure = valueOf(
        await harness.run(
          [
            'try {',
            '  await tools.echo({})',
            '} catch (error) {',
            '  return error.toolName + ":" + error.message',
            '}',
          ].join('\n'),
        ),
      )
      expect(failure).toContain('echo:')
    } finally {
      await harness.dispose()
    }
  })

  it('denies model-direct calls to every tool except the transport', async () => {
    expect.hasAssertions()
    const harness = await createPluginHarness()
    try {
      const denied = failureOf(await harness.call('echo', { text: 'direct' }))
      expect(denied.error.message).toContain('only run is callable directly')
    } finally {
      await harness.dispose()
    }
  })
})
