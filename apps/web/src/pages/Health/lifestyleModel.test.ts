import type { TagImpactItem, TagImpactOutcome } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { formatPValue, splitTagRows } from './lifestyleModel'

const outcome = (enough: boolean): TagImpactOutcome => ({
  cohens_d: null,
  difference: null,
  enough_data: enough,
  mean_with: null,
  mean_without: null,
  metric: 'hrv_sleep',
  n_with: enough ? 10 : 2,
  n_without: 100,
  p_value: null,
})

const tag = (name: string, enough: boolean[]): TagImpactItem => ({
  first_date: '2025-01-01',
  label: name,
  last_date: '2026-10-01',
  outcomes: enough.map(outcome),
  tag: name,
  tagged_days: 10,
})

describe('splitTagRows', () => {
  it('separates comparable tags from too-rare ones, keeping API order in each group', () => {
    const { comparable, tooRare } = splitTagRows([
      tag('a', [false, false]),
      tag('b', [true, false]),
      tag('c', [false]),
      tag('d', [true]),
    ])
    expect(comparable.map((r) => r.tag)).toEqual(['b', 'd'])
    expect(tooRare.map((r) => r.tag)).toEqual(['a', 'c'])
  })
})

describe('formatPValue', () => {
  it('formats p-values', () => {
    expect(formatPValue(0.034)).toBe('p = 0.03')
    expect(formatPValue(0.0042)).toBe('p = 0.004')
    expect(formatPValue(0.0004)).toBe('p < 0.001')
    expect(formatPValue(0.5)).toBe('p = 0.50')
    expect(formatPValue(null)).toBe('—')
  })
})
