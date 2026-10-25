import { describe, expect, it } from 'vitest'

import { sparkModel, sparkX } from './Sparkline'

const point = (date: string, value: number, baseline = { mean: 30, n: 20, sd: 2 }) => ({
  baseline,
  date,
  value,
})

describe('sparkModel', () => {
  it('covers every day in the range and pads the domain to include the band', () => {
    const model = sparkModel(
      [point('2026-10-01', 31), point('2026-10-03', 33)],
      '2026-10-01',
      '2026-10-03',
      true,
      'hrv_sleep',
    )
    expect(model.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(model.byDate.has('2026-10-02')).toBe(false)
    expect(model.domain![0]).toBeLessThanOrEqual(28)
    expect(model.domain![1]).toBeGreaterThanOrEqual(33)
  })

  it('skips the band when asked', () => {
    expect(
      sparkModel([point('2026-10-01', 31)], '2026-10-01', '2026-10-01', false, 'hrv_sleep').segments,
    ).toEqual([])
  })
})

describe('sparkX', () => {
  it('spreads days evenly between the paddings', () => {
    const x = sparkX(['a', 'b', 'c'], 108)
    expect(x('a')).toBe(2)
    expect(x('c')).toBe(102)
    expect(x('b')).toBe(52)
  })
})
