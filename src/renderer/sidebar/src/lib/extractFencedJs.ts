/**
 * Returns the body of the first ```javascript or ```js fenced block in markdown.
 */
export function extractFirstFencedJavaScript(markdown: string): string | null {
  const re = /```(?:javascript|js)\s*\r?\n([\s\S]*?)```/i
  const m = markdown.match(re)
  if (!m) return null
  const body = m[1].trim()
  return body.length > 0 ? body : null
}
