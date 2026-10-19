/* oxlint-disable eslint/no-magic-numbers -- Catalog fixtures use literal budgets and limits. */
/* oxlint-disable vitest/max-expects -- Contract tests assert related catalog facts together. */
/* oxlint-disable vitest/prefer-to-be-truthy, vitest/prefer-to-be-falsy -- Strict boolean matchers are required by prefer-strict-boolean-matchers. */

import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import {
  findToolMatch,
  formatNames,
  isOnlyHelpProgram,
  renderHelp,
} from '#src/help'
import type { ToolDoc } from '#src/help'

const stringSchema: JsonSchemaNode = { type: 'string' }

function docs(): ToolDoc[] {
  return [
    {
      name: 'echo',
      description: 'Echo one string back.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      output: stringSchema,
    },
    {
      name: 'read_file',
      description: 'Read a file from disk and return its contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      output: stringSchema,
    },
    {
      name: 'web_search',
      description: 'Search the web for current information.',
      parameters: {
        type: 'object',
        properties: { queries: { type: 'array', items: { type: 'string' } } },
        required: ['queries'],
        additionalProperties: false,
      },
      output: { type: 'array', items: { type: 'string' } },
    },
  ]
}

/** The first fixture document, narrowed without a test conditional. */
function firstDoc(): ToolDoc {
  const [doc] = docs()
  if (doc === undefined) {
    throw new TypeError('help fixture is missing its first document')
  }
  return doc
}

describe('help formatting', () => {
  it('lists every tool name in stable order', () => {
    expect.hasAssertions()
    const text = renderHelp(docs(), '')
    expect(text).toBe('echo\nread_file\nweb_search')
  })

  it('returns the full definition for an exact name', () => {
    expect.hasAssertions()
    const text = renderHelp(docs(), 'read_file')
    expect(text).toContain('Tool: read_file')
    expect(text).toContain(
      'Description: Read a file from disk and return its contents.',
    )
    expect(text).toContain('Parameters:')
    expect(text).toContain('"path"')
    expect(text).toContain('Returns:')
    expect(text).toContain('\u0060\u0060\u0060json')
  })

  it('shows the name and untruncated description for a fuzzy match', () => {
    expect.hasAssertions()
    const text = renderHelp(docs(), 'reed_file')
    expect(text).toBe(
      'read_file - Read a file from disk and return its contents.',
    )
  })

  it('falls back to the name list when nothing matches', () => {
    expect.hasAssertions()
    const fallback = renderHelp(docs(), 'zzz-not-a-tool')
    expect(fallback).toBe(formatNames(docs()))
  })

  it('treats an empty query like an omitted query', () => {
    expect.hasAssertions()
    expect(renderHelp(docs(), '')).toBe(formatNames(docs()))
  })

  it('does not truncate a fuzzy match description', () => {
    expect.hasAssertions()
    const long: ToolDoc = {
      ...firstDoc(),
      description: 'x'.repeat(500),
    }
    const text = renderHelp([long], 'ecoh')
    expect(text).toBe(['echo - ', 'x'.repeat(500)].join(''))
  })

  it('exposes the best fuzzy match', () => {
    expect.hasAssertions()
    const match = findToolMatch(docs(), 'read')
    expect(match?.name).toBe('read_file')
  })
})

describe('first-program source validation', () => {
  it('accepts exactly one awaited help call', () => {
    expect.hasAssertions()
    for (const code of [
      'return await help()',
      'await help()',
      'return await help("read_file")',
      "await help('echo');",
      '  return  await help(  )  ',
    ]) {
      expect(isOnlyHelpProgram(code)).toBe(true)
    }
  })

  it('rejects any other source', () => {
    expect.hasAssertions()
    for (const code of [
      'return await tools.echo({})',
      'await help(); return "extra"',
      'const text = await help(); return text',
      'console.log(await help())',
      '// help()',
      'return await help(name)',
      'return help()',
    ]) {
      expect(isOnlyHelpProgram(code)).toBe(false)
    }
  })
})
