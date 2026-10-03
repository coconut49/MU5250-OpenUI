// SMS collection helpers (PLAN2 R14). The full validated collection is stored once;
// Inbox / Sent are derived from the selected box at render time. All functions are
// pure and return the SAME array when nothing changes.

import type { SmsMessage } from '../../types'

export type Box = 'inbox' | 'sent'

/** Firmware tags: 0 received/read, 1 received/unread, 2 sent, 3 failed, 4 draft (in neither box). */
export const TAG_READ = 0
export const TAG_UNREAD = 1

export function inBox(messages: readonly SmsMessage[], box: Box): SmsMessage[] {
  return messages.filter((m) => (box === 'inbox' ? m.tag === 0 || m.tag === 1 : m.tag === 2 || m.tag === 3))
}

/** Unread count always comes from the inbox, whichever box is shown. */
export function unreadCount(messages: readonly SmsMessage[]): number {
  return messages.filter((m) => m.tag === TAG_UNREAD).length
}

export function findMessage(messages: readonly SmsMessage[], id: number | null): SmsMessage | null {
  if (id === null) return null
  return messages.find((m) => m.id === id) ?? null
}

/** Keep a selection only while its message still exists in the collection. */
export function reconcileSelection(messages: readonly SmsMessage[], id: number | null): number | null {
  return findMessage(messages, id) ? id : null
}

function retag(messages: SmsMessage[], id: number, from: number, to: number): SmsMessage[] {
  if (!messages.some((m) => m.id === id && m.tag === from)) return messages
  return messages.map((m) => (m.id === id && m.tag === from ? { ...m, tag: to } : m))
}

/** Optimistic / acknowledged read state for one message. */
export function markRead(messages: SmsMessage[], id: number): SmsMessage[] {
  return retag(messages, id, TAG_UNREAD, TAG_READ)
}

/** Roll an optimistic mark-read back. */
export function restoreUnread(messages: SmsMessage[], id: number): SmsMessage[] {
  return retag(messages, id, TAG_READ, TAG_UNREAD)
}

export function removeMessage(messages: SmsMessage[], id: number): SmsMessage[] {
  return messages.some((m) => m.id === id) ? messages.filter((m) => m.id !== id) : messages
}
