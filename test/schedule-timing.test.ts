import { describe, expect, it } from 'vitest'
import { scheduleTimingHint } from '../src/session/schedule-timing.js'

const now = Date.parse('2026-09-30T12:00:00.000Z')
const record = (id: string, scheduledAt: string) => ({ id, kind: 'at' as const, title: id, prompt: 'Synthetic reminder', scheduledAt })

describe('UI-only reminder timing', () => {
  it('shows the earliest planned local time, time zone and seconds countdown', () => {
    const hint = scheduleTimingHint([
      record('later', '2026-09-30T15:00:00.000Z'),
      record('next', '2026-09-30T13:24:00.000Z'),
    ], now, { locale: 'en-US', timeZone: 'Asia/Shanghai' })
    expect(hint?.when).toContain('21:24:00')
    expect(hint?.when).toContain('GMT+8')
    expect(hint?.countdown).toBe('01:24:00')
    expect(hint?.activeCount).toBe(2)
    expect(hint?.details.split('\n')[0]).toMatch(/^next:/u)
    expect(hint?.label).toContain('2 active')
  })

  it('updates purely from the supplied clock and supports Chinese labels', () => {
    const records = [record('task', '2026-09-30T12:01:30.000Z')]
    expect(scheduleTimingHint(records, now, { locale: 'zh-CN', timeZone: 'Asia/Shanghai' })?.label).toContain('剩余 00:01:30')
    expect(scheduleTimingHint(records, now + 1500, { locale: 'zh-CN', timeZone: 'Asia/Shanghai' })?.countdown).toBe('00:01:29')
    expect(records[0]?.scheduledAt).toBe('2026-09-30T12:01:30.000Z')
  })

  it('does not display negative time while waiting for a due Host reminder', () => {
    const hint = scheduleTimingHint([record('due', '2026-09-30T11:59:59.000Z')], now)
    expect(hint?.countdown).toBe('00:00:00')
    expect(hint?.label).toContain('awaiting Host delivery')
  })

  it('formats long delays and ignores invalid/unavailable timing', () => {
    expect(scheduleTimingHint([record('future', '2026-10-02T14:03:04.000Z')], now)?.countdown).toBe('2d 02:03:04')
    expect(scheduleTimingHint([], now)).toBeUndefined()
    expect(scheduleTimingHint([record('invalid', 'not-a-date')], now)).toBeUndefined()
    expect(scheduleTimingHint([record('task', '2026-09-30T13:24:00.000Z')], now, { timeZone: 'invalid-zone' })).toBeUndefined()
  })
})
