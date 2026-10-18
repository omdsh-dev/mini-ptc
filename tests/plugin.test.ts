/* oxlint-disable vitest/prefer-to-be-falsy -- Strict boolean matchers are required by prefer-strict-boolean-matchers. */

import { Context } from '@deepseek-ai/cordis'
import { Loader } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'

import { resolveConfig } from '#src/config'

describe('mini-ptc package', () => {
  it('preserves the function-plugin namespace through Loader unwrapping', async () => {
    expect.hasAssertions()
    const plugin = await import('#src/index')
    expect('default' in plugin).toBe(false)
    expect(plugin.name).toBe('mini-ptc')
    expect(plugin.inject).toStrictEqual(['tools', 'systemPrompt', 'ptcRuntime'])

    const loader = new Loader(new Context())
    expect(loader.unwrapExports(plugin)).toBe(plugin)
  })

  it('exports a Loader-facing schema and activation', async () => {
    expect.hasAssertions()
    const plugin = await import('#src/index')
    expect(plugin.Config).toBeDefined()
    expect(plugin.apply).toBeTypeOf('function')
  })

  it('resolves configuration defaults', () => {
    expect.hasAssertions()
    expect(resolveConfig()).toStrictEqual({
      toolName: 'run',
      timeoutMs: 120_000,
      maxTimeoutMs: 600_000,
    })
  })

  it('rejects reserved or malformed transport names', () => {
    expect.hasAssertions()
    expect(() => resolveConfig({ toolName: 'run_code' })).toThrow(/reserved/u)
    expect(() => resolveConfig({ toolName: 'help' })).toThrow(/reserved/u)
    expect(() => resolveConfig({ toolName: 'bad name' })).toThrow(
      /valid tool identifier/u,
    )
    expect(() => resolveConfig({ toolName: '' })).toThrow(
      /valid tool identifier/u,
    )
  })

  it('rejects unusable budgets', () => {
    expect.hasAssertions()
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrow(/positive integer/u)
    expect(() =>
      resolveConfig({ timeoutMs: 2000, maxTimeoutMs: 1000 }),
    ).toThrow(/greater than or equal/u)
  })
})
