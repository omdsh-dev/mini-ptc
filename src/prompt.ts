/**
 * Model-facing prompt fragment for the mini PTC transport. The generated SDK is
 * replaced by this short introduction; tool details are fetched at run time
 * through help().
 *
 * @module mini-ptc/prompt
 */

/** One backtick, written without a template literal so this file stays plain. */
const TICK = '\u0060'

/**
 * Render the compact help introduction shown in place of the generated SDK.
 *
 * @param toolName - The single directly callable transport tool.
 * @returns Prompt text.
 */
function renderHelpPrompt(toolName: string): string {
  const toolsAccess = `${TICK}await tools.<name>(args)${TICK}`
  return [
    '## Tool access with help()',
    '',
    `Only ${TICK}${toolName}${TICK} can be called directly. Inside its program:`,
    '',
    `- ${TICK}await help()${TICK} lists every available tool name.`,
    `- ${TICK}await help("name")${TICK} returns that tool's full description, parameters, and output. A fuzzy match returns the name and full description; when nothing matches, the name list is returned instead.`,
    `- Call a tool after ${TICK}help()${TICK} gives you its exact name and arguments: ${toolsAccess}.`,
    `- Tool failures reject with ${TICK}ToolCallError${TICK}; its ${TICK}toolName${TICK} identifies the failing tool.`,
    '',
    `The program is the body of an async TypeScript function: erasable syntax only, with top-level ${TICK}await${TICK} and ${TICK}return${TICK}. Emit output with ${TICK}console.log(...)${TICK} or ${TICK}return${TICK}.`,
  ].join('\n')
}

export { renderHelpPrompt }
