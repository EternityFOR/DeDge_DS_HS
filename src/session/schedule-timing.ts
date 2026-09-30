import type { WorkbenchSchedule } from './types.js'

export interface ScheduleTimingHint {
  readonly label: string
  readonly details: string
  readonly when: string
  readonly countdown: string
  readonly activeCount: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** UI-only wall-clock hint. It neither advances a reminder nor sends a request. */
export function scheduleTimingHint(
  records: readonly WorkbenchSchedule[],
  now = Date.now(),
  options: { readonly locale?: string; readonly timeZone?: string } = {},
): ScheduleTimingHint | undefined {
  if (!Number.isFinite(now)) return undefined
  const active = records.map(record => ({ record, at: Date.parse(record.scheduledAt) }))
    .filter(item => Number.isFinite(item.at))
    .sort((left, right) => left.at - right.at || left.record.id.localeCompare(right.record.id))
  const next = active[0]
  if (next === undefined) return undefined
  const locale = options.locale ?? 'en-US'
  const chinese = locale.toLowerCase().startsWith('zh')
  const key = `${locale}:${options.timeZone ?? 'local'}`
  let formatter = formatters.get(key)
  if (formatter === undefined) {
    try {
      formatter = new Intl.DateTimeFormat(locale, {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23', timeZoneName: 'short', ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
      })
    } catch {
      return undefined
    }
    if (formatters.size >= 8) formatters.clear()
    formatters.set(key, formatter)
  }
  const countdownFor = (at: number): string => {
    let seconds = Math.max(0, Math.ceil((at - now) / 1000))
    const days = Math.floor(seconds / 86_400)
    seconds %= 86_400
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor(seconds % 3600 / 60)
    const clock = [hours, minutes, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
    return days > 0 ? `${days}${chinese ? '天' : 'd'} ${clock}` : clock
  }
  const when = formatter.format(next.at)
  const countdown = countdownFor(next.at)
  const remaining = next.at <= now ? (chinese ? '等待 Host 触发' : 'due now; awaiting Host delivery') : (chinese ? `剩余 ${countdown}` : `${countdown} remaining`)
  const count = active.length > 1 ? (chinese ? `（${active.length} 项计划）` : ` (${active.length} active)`) : ''
  return {
    label: chinese ? `计划触发 ${when} · ${remaining}${count}` : `Scheduled for ${when} · ${remaining}${count}`,
    details: active.slice(0, 5).map(({ record, at }) => `${(record.title ?? record.id).slice(0, 80)}: ${formatter.format(at)} · ${countdownFor(at)}`).join('\n')
      + (active.length > 5 ? `\n+${active.length - 5} ${chinese ? '项计划' : 'more reminders'}` : ''),
    when,
    countdown,
    activeCount: active.length,
  }
}
