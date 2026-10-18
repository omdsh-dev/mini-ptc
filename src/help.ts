/**
 * Pure tool-document formatting and fuzzy lookup for the in-program `help()`
 * function. Kept free of Cordis and registry state so the catalog rules can be
 * tested without a host.
 *
 * @module mini-ptc/help
 */

/* oxlint-disable eslint/no-magic-numbers -- Scoring weights and index offsets are documented beside their use. */
/* oxlint-disable eslint/no-ternary -- Compact catalog formatting is clearer than branching assignments. */

import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

/** One model-facing tool document. */
interface ToolDoc {
  /** Registered tool name. */
  name: string
  /** Tool description as registered. */
  description: string
  /** Canonical argument JSON Schema. */
  parameters: JsonSchemaNode
  /** Canonical output JSON Schema, when the definition still resolves. */
  output: JsonSchemaNode | undefined
}

/** Lowest fuzzy score that still counts as a matching tool. */
const MIN_FUZZY_SCORE = 45

/** Normalize free-form query and description text for matching and display. */
function normalizeText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim()
}

/** Whether `needle` appears in `haystack` in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0
  for (const character of haystack) {
    if (character === needle[index]) {
      index += 1
    }
    if (index === needle.length) {
      return true
    }
  }
  return false
}

/** Levenshtein distance, bounded to short tool-name lengths. */
function editDistance(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  if (left.length === 0) {
    return right.length
  }
  if (right.length === 0) {
    return left.length
  }
  let previous = Array.from(
    { length: right.length + 1 },
    (_unused, elementIndex) => elementIndex,
  )
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution =
        (previous[rightIndex - 1] ?? Number.POSITIVE_INFINITY)
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? Number.POSITIVE_INFINITY) + 1,
        (current[rightIndex - 1] ?? Number.POSITIVE_INFINITY) + 1,
        substitution,
      )
    }
    previous = current
  }
  return previous[right.length] ?? Math.max(left.length, right.length)
}

/** The name-only catalog returned by `help()` and by an unmatched query. */
function formatNames(tools: readonly ToolDoc[]): string {
  if (tools.length === 0) {
    return 'No tools are available.'
  }
  return tools
    .map((tool) => tool.name)
    .toSorted((left, right) => left.localeCompare(right))
    .join('\n')
}

/** One fuzzy match with its untruncated one-line description. */
function formatFuzzy(tool: ToolDoc): string {
  const description = normalizeText(tool.description) || '(no description)'
  return `${tool.name} - ${description}`
}

/** Render one JSON Schema for the full-information view. */
function renderSchema(schema: JsonSchemaNode | undefined): string {
  if (schema === undefined) {
    return '(not declared)'
  }
  try {
    return JSON.stringify(schema, undefined, 2)
  } catch {
    return '(unrenderable schema)'
  }
}

/** The full description, parameters, and output for one tool. */
function formatDetails(tool: ToolDoc): string {
  const description = normalizeText(tool.description) || '(no description)'
  return [
    `Tool: ${tool.name}`,
    `Description: ${description}`,
    '',
    'Parameters:',
    '```json',
    renderSchema(tool.parameters),
    '```',
    '',
    'Returns:',
    '```json',
    renderSchema(tool.output),
    '```',
  ].join('\n')
}

/** Score one tool against a normalized query. Higher is a better match. */
function scoreTool(tool: ToolDoc, query: string): number {
  const name = tool.name.toLowerCase()
  const description = normalizeText(tool.description).toLowerCase()
  const tokens = name.split(/[^a-z0-9]+/u).filter((token) => token.length > 0)
  let score = 0

  if (name === query) {
    return 100
  }
  if (name.startsWith(query)) {
    score = Math.max(score, 80 - Math.min(10, name.length - query.length))
  }
  if (name.includes(query)) {
    score = Math.max(score, 70 - Math.min(10, name.indexOf(query)))
  }
  if (tokens.includes(query)) {
    score = Math.max(score, 75)
  } else if (tokens.some((token) => token.startsWith(query))) {
    score = Math.max(score, 65)
  }
  if (query.length >= 2 && isSubsequence(query, name)) {
    score = Math.max(
      score,
      50 + Math.round((20 * query.length) / Math.max(name.length, 1)),
    )
  }
  if (description.includes(query)) {
    score = Math.max(score, 45)
  }

  const nameDistance = editDistance(query, name)
  if (nameDistance <= 3) {
    score = Math.max(score, 60 - nameDistance * 10)
  }
  for (const token of tokens) {
    const distance = editDistance(query, token)
    if (distance <= 2) {
      score = Math.max(score, 62 - distance * 8)
    }
  }
  return score
}

/** Resolve the best fuzzy match for one query. */
function findToolMatch(
  tools: readonly ToolDoc[],
  query: string,
): ToolDoc | undefined {
  const normalized = query.toLowerCase()
  if (normalized.length === 0) {
    return undefined
  }

  const scored = tools
    .map((tool) => ({ tool, score: scoreTool(tool, normalized) }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score
        || left.tool.name.localeCompare(right.tool.name),
    )
  const [best] = scored
  if (best === undefined || best.score < MIN_FUZZY_SCORE) {
    return undefined
  }
  return best.tool
}

/**
 * Render the help response: no query lists tool names, an exact match shows the
 * full definition, a fuzzy match shows the name and full description, and a
 * miss falls back to the name list.
 *
 * @param tools - Every tool visible to the calling program.
 * @param query - Optional tool name or fragment.
 * @returns Model-facing text.
 */
function renderHelp(
  tools: readonly ToolDoc[],
  query: string | undefined,
): string {
  const normalized = query === undefined ? '' : normalizeText(query)
  if (normalized.length === 0) {
    return formatNames(tools)
  }
  const exact = tools.find(
    (tool) => tool.name.toLowerCase() === normalized.toLowerCase(),
  )
  if (exact !== undefined) {
    return formatDetails(exact)
  }
  const match = findToolMatch(tools, normalized)
  if (match === undefined) {
    return formatNames(tools)
  }
  return formatFuzzy(match)
}

export {
  findToolMatch,
  formatDetails,
  formatFuzzy,
  formatNames,
  renderHelp,
  type ToolDoc,
}
