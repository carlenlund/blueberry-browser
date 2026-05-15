import { normalizeQuickOpenInput } from '@shared/navigateQuickOpen'

/**
 * Normalize user-typed navigate input into a full URL (https or google search).
 */
export function normalizeNavigateInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return normalizeQuickOpenInput(trimmed)
}
