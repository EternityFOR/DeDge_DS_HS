import type { WorkbenchMessage } from '../session/types.js'

export interface PendingSendReceipt {
  readonly requestId?: string
  readonly text: string
  readonly attachmentLabels: readonly string[]
  readonly baselineIds: ReadonlySet<string>
  readonly baselineSeq?: number
}

/** Durable input acknowledgement, independent of the provider's response.
 * Current Harness preserves the prompt requestId as source.rpcId. Legacy
 * runtimes without that field use a new human message with matching text AND
 * attachments; an empty string alone must never match arbitrary history.
 */
export function hasDurableSendReceipt(receipt: PendingSendReceipt, messages: readonly WorkbenchMessage[]): boolean {
  return messages.some(message => {
    if (message.role !== 'user' || message.inputKind === 'automation' || receipt.baselineIds.has(message.id)) return false
    if (receipt.requestId !== undefined && message.requestId !== undefined) return receipt.requestId === message.requestId
    if (receipt.baselineSeq !== undefined && message.seq !== undefined && message.seq <= receipt.baselineSeq) return false
    if (normalize(message.text) !== normalize(receipt.text)) return false
    if (receipt.attachmentLabels.length === 0) return normalize(receipt.text) !== '' && (message.attachments?.length ?? 0) === 0
    const labels = (message.attachments ?? []).map(attachment => normalize(attachment.label))
    return receipt.attachmentLabels.every(label => {
      const index = labels.indexOf(normalize(label))
      if (index < 0) return false
      labels.splice(index, 1)
      return true
    })
  })
}

function normalize(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim()
}
