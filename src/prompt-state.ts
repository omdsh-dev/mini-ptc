/**
 * Per-session prompt state: pinned tool references from exact help() calls and
 * the most-used tools injected after a compaction.
 *
 * @module mini-ptc/prompt-state
 */

import type { ToolDoc } from './help.ts'

/** Number of most-used tools injected after each compaction. */
const FEATURED_TOOL_LIMIT = 5
const NO_USES = 0
const ONE_USE = 1
const FIRST_INDEX = 0

/** One session's accumulated prompt references. */
interface SessionPromptState {
  /** Tool call counts since the last compaction. */
  counts: Map<string, number>
  /** Last known document for each referenced tool. */
  docs: Map<string, ToolDoc>
  /** Tools pinned by an exact help() call, in pin order. */
  pinned: Set<string>
  /** Tools selected from the last compacted segment. */
  featured: string[]
}

/** Store prompt references by session id; owned by the plugin fiber. */
class PromptStateStore {
  private readonly states = new Map<string, SessionPromptState>()

  /** Pin one exact tool reference for the session. */
  public pin(sessionId: string, tool: ToolDoc): void {
    const state = this.get(sessionId)
    state.docs.set(tool.name, tool)
    state.pinned.add(tool.name)
  }

  /** Record one dispatched program tool call. */
  public recordUse(sessionId: string, tool: ToolDoc): void {
    const state = this.get(sessionId)
    state.docs.set(tool.name, tool)
    const count = state.counts.get(tool.name) ?? NO_USES
    state.counts.set(tool.name, count + ONE_USE)
  }

  /** Select the top tools from the segment that was just compacted. */
  public compact(sessionId: string): void {
    const state = this.states.get(sessionId)
    if (state === undefined) {
      return
    }
    const ranked = [...state.counts.entries()].toSorted(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    )
    state.featured = ranked
      .slice(FIRST_INDEX, FEATURED_TOOL_LIMIT)
      .map(([name]) => name)
    state.counts.clear()
  }

  /** Documents to render into the prompt: pins first, then featured tools. */
  public docsFor(sessionId: string): ToolDoc[] {
    const state = this.states.get(sessionId)
    if (state === undefined) {
      return []
    }
    const names = [...state.pinned]
    for (const name of state.featured) {
      if (!state.pinned.has(name)) {
        names.push(name)
      }
    }
    const docs: ToolDoc[] = []
    for (const name of names) {
      const doc = state.docs.get(name)
      if (doc !== undefined) {
        docs.push(doc)
      }
    }
    return docs
  }

  /** Drop one session's state. */
  public delete(sessionId: string): void {
    this.states.delete(sessionId)
  }

  /** Drop every session's state on plugin disposal. */
  public clear(): void {
    this.states.clear()
  }

  private get(sessionId: string): SessionPromptState {
    let state = this.states.get(sessionId)
    if (state === undefined) {
      state = {
        counts: new Map(),
        docs: new Map(),
        pinned: new Set(),
        featured: [],
      }
      this.states.set(sessionId, state)
    }
    return state
  }
}

/** The session id carried by the prompt scope's Agent, if this scope has one. */
function sessionIdOfScope(scope?: object): string | undefined {
  if (scope === undefined || !('session' in scope)) {
    return undefined
  }
  const { session } = scope
  if (typeof session !== 'object' || session === null || !('id' in session)) {
    return undefined
  }
  const { id } = session
  if (typeof id === 'string') {
    return id
  }
  return undefined
}

export {
  FEATURED_TOOL_LIMIT,
  PromptStateStore,
  sessionIdOfScope,
  type SessionPromptState,
}
