import { isRecord } from '../gateway/protocol.js'

/** A presentation diagnostic, never a request to retry or rewrite model output. */
export function isReasoningOnlyResponse(data: Record<string, unknown>): boolean {
  const message = isRecord(data.message) ? data.message : undefined
  if (message === undefined || message.interrupted === true || data.interrupted === true || !Array.isArray(message.content)) return false
  let reasoning = false
  for (const block of message.content) {
    if (!isRecord(block)) return false
    if (block.type === 'reasoning' && typeof block.text === 'string') reasoning ||= block.text.trim() !== ''
    else if (block.type !== 'text' || typeof block.text !== 'string' || block.text.trim() !== '') return false
  }
  return reasoning
}

/** Failed attempts are not assistant messages. Keep only their received reasoning
 * visible, and only for the explicit empty-answer failure (never as final text).
 */
export function emptyAttemptReasoning(data: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(data.stream)) return []
  const failed = data.stream.some(row => isRecord(row) && row.type === 'chunk'
    && isRecord(row.chunk) && row.chunk.type === 'finish' && isRecord(row.chunk.reason)
    && row.chunk.reason.kind === 'error' && isRecord(row.chunk.reason.failure)
    && row.chunk.reason.failure.code === 'EMPTY_RESPONSE')
  if (!failed) return []
  return data.stream.flatMap(row => {
    if (!isRecord(row) || row.type !== 'chunk' || !isRecord(row.chunk) || row.chunk.type !== 'block-end') return []
    const block = row.chunk.block
    return isRecord(block) && block.type === 'reasoning' && typeof block.text === 'string' && block.text.trim() !== '' ? [block.text] : []
  })
}
