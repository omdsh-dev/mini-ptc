/* oxlint-disable eslint/no-magic-numbers -- Usage counts are literal fixtures. */
/* oxlint-disable vitest/prefer-to-be-truthy, vitest/prefer-to-be-falsy -- Strict boolean matchers are required by prefer-strict-boolean-matchers. */

import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

import type { ToolDoc } from '#src/help'
import { PromptStateStore, sessionIdOfScope } from '#src/prompt-state'

const stringSchema: JsonSchemaNode = { type: 'string' }

/** One minimal tool document. */
function doc(name: string): ToolDoc {
  return {
    name,
    description: [name, 'tool'].join(' '),
    parameters: { type: 'object', additionalProperties: false },
    output: stringSchema,
  }
}

/** Options for one fixture usage burst. */
interface UseOptions {
  store: PromptStateStore
  sessionId: string
  name: string
  times: number
}

/** Record one tool use a fixed number of times. */
function use(options: UseOptions): void {
  const { store, sessionId, name, times } = options
  for (let index = 0; index < times; index += 1) {
    store.recordUse(sessionId, doc(name))
  }
}

describe('prompt state', () => {
  it('tracks first help discovery per session', () => {
    expect.hasAssertions()
    const store = new PromptStateStore()
    expect(store.hasCalledHelp('session-a')).toBe(false)
    store.markHelpCalled('session-a')
    expect(store.hasCalledHelp('session-a')).toBe(true)
    store.delete('session-a')
    expect(store.hasCalledHelp('session-a')).toBe(false)
  })

  it('pins exact tool documents', () => {
    expect.hasAssertions()
    const store = new PromptStateStore()
    store.pin('session-a', doc('read_file'))
    expect(store.docsFor('session-a').map((tool) => tool.name)).toStrictEqual([
      'read_file',
    ])
  })

  it('features the five most-used tools and resets segment counts', () => {
    expect.hasAssertions()
    const store = new PromptStateStore()
    use({ store, sessionId: 'session-a', name: 'a', times: 6 })
    use({ store, sessionId: 'session-a', name: 'b', times: 5 })
    use({ store, sessionId: 'session-a', name: 'c', times: 4 })
    use({ store, sessionId: 'session-a', name: 'd', times: 3 })
    use({ store, sessionId: 'session-a', name: 'e', times: 2 })
    use({ store, sessionId: 'session-a', name: 'f', times: 1 })

    store.compact('session-a')
    expect(store.docsFor('session-a').map((tool) => tool.name)).toStrictEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ])

    use({ store, sessionId: 'session-a', name: 'f', times: 1 })
    store.compact('session-a')
    expect(store.docsFor('session-a').map((tool) => tool.name)).toStrictEqual([
      'f',
    ])
  })

  it('deduplicates pinned and featured tools', () => {
    expect.hasAssertions()
    const store = new PromptStateStore()
    store.pin('session-a', doc('a'))
    use({ store, sessionId: 'session-a', name: 'a', times: 2 })
    use({ store, sessionId: 'session-a', name: 'b', times: 1 })
    store.compact('session-a')
    expect(store.docsFor('session-a').map((tool) => tool.name)).toStrictEqual([
      'a',
      'b',
    ])
  })

  it('reads the session id from an agent-shaped scope', () => {
    expect.hasAssertions()
    expect(sessionIdOfScope({ session: { id: 'session-a' } })).toBe('session-a')
    expect(sessionIdOfScope({})).toBeUndefined()
    expect(sessionIdOfScope()).toBeUndefined()
  })
})
