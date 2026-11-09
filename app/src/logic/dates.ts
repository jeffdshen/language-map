/** Learning day key (local time) with an early-morning rollover, e.g. 01:30 counts as the previous day. */
export function dayKey(date: Date = new Date(), rolloverHour = 4): string {
  // Wall-clock arithmetic (not a fixed offset in ms) so DST days roll over at the right hour.
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  if (date.getHours() < rolloverHour) d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const pa = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
  const pb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))
  return Math.round((pb - pa) / 86_400_000)
}
