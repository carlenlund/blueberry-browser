import type { ChatSidebarMessage } from '../types/chat'

export function textFromCoreLikeMessage(msg: unknown): string {
  if (!msg || typeof msg !== 'object') return ''
  const m = msg as { role?: string; content?: unknown }
  if (m.role !== 'user' && m.role !== 'assistant') return ''
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    const textPart = m.content.find(
      (p: unknown) =>
        p &&
        typeof p === 'object' &&
        'type' in p &&
        (p as { type: string }).type === 'text'
    ) as { text?: string } | undefined
    return textPart?.text ?? ''
  }
  return ''
}

export function messagesFromStored(stored: unknown[]): ChatSidebarMessage[] {
  return stored.map((msg, index) => ({
    id: `msg-${index}`,
    role: (msg as { role: ChatSidebarMessage['role'] }).role,
    content: textFromCoreLikeMessage(msg),
    timestamp: Date.now(),
    isStreaming: false,
  }))
}
