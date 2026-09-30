import { describe, expect, it } from 'vitest'
import { hasDurableSendReceipt, type PendingSendReceipt } from '../src/ui/send-receipt.js'
import type { WorkbenchMessage } from '../src/session/types.js'

const receipt: PendingSendReceipt = { requestId: 'send-1', text: '', attachmentLabels: ['Image: image.png'], baselineIds: new Set(['old-image']) }
const image: WorkbenchMessage = { id: 'new-image', requestId: 'send-1', role: 'user', text: '', attachments: [{ kind: 'image', label: 'Image: image.png' }] }

describe('durable send acknowledgement', () => {
  it('acknowledges image-only inputs by the official request id, without a reply', () => {
    expect(hasDurableSendReceipt(receipt, [image])).toBe(true)
  })
  it('acknowledges long-paste attachment-only input and native context projection', () => {
    const paste = { ...receipt, attachmentLabels: ['pasted-text.txt'] }
    expect(hasDurableSendReceipt(paste, [{ ...image, attachments: [{ kind: 'file', label: 'pasted-text.txt' }] }])).toBe(true)
    expect(hasDurableSendReceipt(paste, [{ ...image, text: 'provider-normalized text' }])).toBe(true)
  })
  it('does not consume old messages, a different request, or agent-owned schedules', () => {
    expect(hasDurableSendReceipt(receipt, [{ ...image, id: 'old-image' }])).toBe(false)
    expect(hasDurableSendReceipt(receipt, [{ ...image, requestId: 'send-2' }])).toBe(false)
    expect(hasDurableSendReceipt(receipt, [{ ...image, inputKind: 'automation' }])).toBe(false)
  })
  it('supports legacy attachment-only messages without matching every empty string', () => {
    const { requestId: _requestId, ...legacy } = image
    expect(hasDurableSendReceipt(receipt, [legacy])).toBe(true)
    expect(hasDurableSendReceipt(receipt, [{ ...legacy, attachments: [] }])).toBe(false)
    expect(hasDurableSendReceipt(receipt, [{ ...legacy, attachments: [{ kind: 'image', label: 'Image: other.png' }] }])).toBe(false)
    expect(hasDurableSendReceipt({ ...receipt, attachmentLabels: [] }, [legacy])).toBe(false)
  })
  it('requires matching legacy text and all attachments, not a repeated body alone', () => {
    const mixed = { ...receipt, text: 'Check this\r\nplease' }
    const { requestId: _requestId, ...legacy } = { ...image, text: 'Check this\nplease' }
    expect(hasDurableSendReceipt(mixed, [legacy])).toBe(true)
    expect(hasDurableSendReceipt(mixed, [{ ...legacy, attachments: [] }])).toBe(false)
    expect(hasDurableSendReceipt(mixed, [{ ...legacy, text: 'Check something else' }])).toBe(false)
  })
  it('does not acknowledge a repeated attachment discovered by loading older history', () => {
    const { requestId: _requestId, ...legacy } = image
    expect(hasDurableSendReceipt({ ...receipt, baselineSeq: 100 }, [{ ...legacy, seq: 20 }])).toBe(false)
    expect(hasDurableSendReceipt({ ...receipt, baselineSeq: 100 }, [{ ...legacy, seq: 101 }])).toBe(true)
  })
})
