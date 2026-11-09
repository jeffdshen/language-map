import { describe, expect, it } from 'vitest'
import { dayKey, daysBetween } from './dates'

describe('dates', () => {
  it('rolls over at the configured local hour', () => {
    expect(dayKey(new Date(2024, 5, 10, 3, 59), 4)).toBe('2024-06-09')
    expect(dayKey(new Date(2024, 5, 10, 4, 0), 4)).toBe('2024-06-10')
    expect(dayKey(new Date(2024, 0, 1, 1, 0), 4)).toBe('2023-12-31')
    expect(dayKey(new Date(2024, 5, 10, 0, 30), 0)).toBe('2024-06-10')
  })

  it('uses wall-clock hours on DST transition days', () => {
    // 2024-03-10 is a DST day in US time zones; 04:30 local is still after a 4am rollover.
    expect(dayKey(new Date(2024, 2, 10, 4, 30), 4)).toBe('2024-03-10')
    expect(dayKey(new Date(2024, 10, 3, 4, 30), 4)).toBe('2024-11-03')
    expect(dayKey(new Date(2024, 10, 3, 3, 30), 4)).toBe('2024-11-02')
  })

  it('counts days between keys', () => {
    expect(daysBetween('2024-03-09', '2024-03-11')).toBe(2)
    expect(daysBetween('2024-12-31', '2025-01-01')).toBe(1)
  })
})
