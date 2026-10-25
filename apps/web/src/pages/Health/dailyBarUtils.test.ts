import { describe, expect, it } from 'vitest'

import { isoWeekStart, labelIndices, stackBars, unitTicks, weeklySums, weeksCovering } from './dailyBarUtils'

describe('stackBars', () => {
  const high = { key: 'high', values: new Map([['2026-10-01', 10]]) }
  const medium = {
    key: 'medium',
    values: new Map([
      ['2026-10-01', 20],
      ['2026-10-02', 5],
    ]),
  }

  it('stacks upward in series order and marks the top segment as outer', () => {
    const { bars, max, min } = stackBars(['2026-10-01', '2026-10-02'], [high, medium])
    expect(bars[0]?.segments).toEqual([
      { key: 'high', outer: false, value: 10, y0: 0, y1: 10 },
      { key: 'medium', outer: true, value: 20, y0: 10, y1: 30 },
    ])
    expect(bars[1]?.segments).toEqual([{ key: 'medium', outer: true, value: 5, y0: 0, y1: 5 }])
    expect(max).toBe(30)
    expect(min).toBe(0)
  })

  it('stacks down series below zero for diverging bars', () => {
    const restore = { direction: 'down' as const, key: 'restore', values: new Map([['2026-10-01', 40]]) }
    const { bars, max, min } = stackBars(['2026-10-01'], [high, restore])
    expect(bars[0]?.segments).toEqual([
      { key: 'high', outer: true, value: 10, y0: 0, y1: 10 },
      { key: 'restore', outer: true, value: 40, y0: 0, y1: -40 },
    ])
    expect(max).toBe(10)
    expect(min).toBe(-40)
  })

  it('skips missing, zero and non-finite values and keeps empty days', () => {
    const zero = {
      key: 'z',
      values: new Map([
        ['2026-10-01', 0],
        ['2026-10-02', Number.NaN],
      ]),
    }
    const { bars, max } = stackBars(['2026-10-01', '2026-10-02', '2026-10-03'], [zero])
    expect(bars.map((b) => b.segments.length)).toEqual([0, 0, 0])
    expect(max).toBe(0)
  })
})

describe('weekly aggregation', () => {
  it('finds the ISO-week Monday', () => {
    expect(isoWeekStart('2026-10-24')).toBe('2026-10-19')
    expect(isoWeekStart('2026-10-19')).toBe('2026-10-19')
    expect(isoWeekStart('2026-10-25')).toBe('2026-10-19')
    expect(isoWeekStart('2026-01-01')).toBe('2025-12-29')
  })

  it('sums days into their weeks', () => {
    const sums = weeklySums(
      new Map([
        ['2026-10-20', 30],
        ['2026-10-18', 5],
        ['2026-10-25', 10],
        ['2026-10-26', 7],
      ]),
    )
    expect([...sums.entries()]).toEqual([
      ['2026-10-12', 5],
      ['2026-10-19', 40],
      ['2026-10-26', 7],
    ])
  })

  it('lists the weeks covering a range', () => {
    expect(weeksCovering('2026-10-01', '2026-10-24')).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ])
  })
})

describe('labelIndices', () => {
  it('spaces labels and always keeps the last', () => {
    expect(labelIndices(7, 60)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(labelIndices(10, 20)).toEqual([0, 3, 6, 9])
    expect(labelIndices(0, 20)).toEqual([])
  })
})

describe('unitTicks', () => {
  it('puts duration ticks on whole hours', () => {
    expect(unitTicks(0, 11.1 * 3600, 3600)).toEqual([0, 3, 6, 9, 12].map((h) => h * 3600))
    expect(unitTicks(0, 7 * 3600, 3600)).toEqual([0, 2, 4, 6, 8].map((h) => h * 3600))
  })
  it('uses half or quarter hours for short spans and covers negative values', () => {
    expect(unitTicks(0, 0.9 * 3600, 3600)).toEqual([0, 0.25, 0.5, 0.75, 1].map((h) => h * 3600))
    expect(unitTicks(-3 * 3600, 2 * 3600, 3600)).toEqual([-4, -2, 0, 2].map((h) => h * 3600))
  })
})
