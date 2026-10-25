import type { HealthDailyPoint } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import {
  balanceValues,
  daySummaryCounts,
  daySummaryOf,
  resilienceChip,
  resilienceLevelOf,
} from './stressModel'

const pt = (date: string, value: number): HealthDailyPoint => ({ baseline: null, date, value })

describe('day summary', () => {
  it('maps the stored level to a summary', () => {
    expect(daySummaryOf(1)).toBe('restored')
    expect(daySummaryOf(2)).toBe('normal')
    expect(daySummaryOf(3)).toBe('stressful')
    expect(daySummaryOf(0)).toBeNull()
  })

  it('counts each summary', () => {
    expect(daySummaryCounts([pt('2026-10-01', 1), pt('2026-10-02', 3), pt('2026-10-03', 3)])).toEqual({
      normal: 0,
      restored: 1,
      stressful: 2,
    })
  })
})

describe('resilience', () => {
  it('maps 20…100 to the five levels', () => {
    expect(resilienceLevelOf(20)).toBe('limited')
    expect(resilienceLevelOf(60)).toBe('solid')
    expect(resilienceLevelOf(100)).toBe('exceptional')
    expect(resilienceLevelOf(0)).toBeNull()
  })

  it('chips limited as watch and solid and up as good', () => {
    expect(resilienceChip('limited')).toEqual({ label: 'Limited', tone: 'watch' })
    expect(resilienceChip('adequate').tone).toBe('info')
    expect(resilienceChip('strong')).toEqual({ label: 'Strong', tone: 'good' })
  })
})

describe('balanceValues', () => {
  const points = [pt('2026-10-18', 600), pt('2026-10-19', 1200), pt('2026-10-24', 300)]

  it('keeps daily values', () => {
    expect([...balanceValues(points, 'daily').entries()]).toEqual([
      ['2026-10-18', 600],
      ['2026-10-19', 1200],
      ['2026-10-24', 300],
    ])
  })

  it('sums into ISO weeks', () => {
    expect([...balanceValues(points, 'weekly').entries()]).toEqual([
      ['2026-10-12', 600],
      ['2026-10-19', 1500],
    ])
  })
})
