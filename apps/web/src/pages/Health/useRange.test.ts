import { describe, expect, it } from 'vitest'

import { optionLabel } from './RangeSelector'
import { parseRange, rangeDates, rangeUrl } from './useRange'

describe('parseRange', () => {
  const allowed = [7, 30, 90, 365]

  it('accepts an allowed value', () => {
    expect(parseRange('7', allowed)).toBe(7)
    expect(parseRange('365', allowed)).toBe(365)
  })

  it('falls back to 30 for missing, malformed or disallowed values', () => {
    expect(parseRange(undefined, allowed)).toBe(30)
    expect(parseRange('abc', allowed)).toBe(30)
    expect(parseRange('14', allowed)).toBe(30)
    expect(parseRange('', allowed)).toBe(30)
  })

  it('falls back to the first option when 30 is not allowed', () => {
    expect(parseRange(undefined, [7, 90])).toBe(7)
  })

  it('uses a page-specific default when given', () => {
    expect(parseRange(undefined, [90, 365, 1095], 365)).toBe(365)
    expect(parseRange('30', [90, 365, 1095], 365)).toBe(365)
    expect(parseRange('1095', [90, 365, 1095], 365)).toBe(1095)
  })
})

describe('rangeDates', () => {
  it('ends today and spans the given number of days inclusive', () => {
    expect(rangeDates(7, new Date(2026, 9, 24, 15))).toEqual({ end: '2026-10-24', start: '2026-10-18' })
    expect(rangeDates(1, new Date(2026, 9, 24))).toEqual({ end: '2026-10-24', start: '2026-10-24' })
  })
})

describe('rangeUrl', () => {
  it('sets range and keeps other query params', () => {
    expect(rangeUrl('/sleep', { embed: '1', range: '30' }, 90)).toBe('/sleep?embed=1&range=90')
    expect(rangeUrl('/health/recovery', {}, 7)).toBe('/health/recovery?range=7')
  })
})

describe('optionLabel', () => {
  it('labels whole years in years and the rest in days', () => {
    expect(optionLabel(30)).toBe('30 days')
    expect(optionLabel(365)).toBe('1 y')
    expect(optionLabel(1095)).toBe('3 y')
    expect(optionLabel(3650)).toBe('10 y')
  })
})
