import { describe, expect, test } from 'vitest'

import { buildTagImpact, controlWakeDays, exposureDay, humanizeTag, tagLabel } from './tag-impact.ts'

const TZ = 'Europe/Ljubljana'

describe('labels', () => {
  test('humanizes Oura tag types', () => {
    expect(humanizeTag('tag_sleep_alcohol')).toBe('Alcohol')
    expect(humanizeTag('tag_generic_late_meal')).toBe('Late meal')
    expect(humanizeTag('sleeping_alone')).toBe('Sleeping alone')
    expect(humanizeTag('tag_generic_nocaffeine')).toBe('No caffeine')
    expect(humanizeTag('tag_sleep_latemeal')).toBe('Late meal')
  })

  test('uses the definition display name unless it is just the raw type', () => {
    expect(tagLabel({ activity_type: 'tag_sleep_alcohol', display_name: 'Drinks' })).toBe('Drinks')
    expect(tagLabel({ activity_type: 'tag_sleep_alcohol', display_name: 'tag_sleep_alcohol' })).toBe(
      'Alcohol',
    )
    expect(tagLabel({ activity_type: 'tag_sleep_alcohol', display_name: null })).toBe('Alcohol')
  })
})

describe('exposureDay', () => {
  test('tags logged after midnight and before 05:00 belong to the previous evening', () => {
    expect(exposureDay(new Date('2026-06-01T20:00:00Z'), TZ)).toBe('2026-06-01')
    expect(exposureDay(new Date('2026-06-01T23:30:00Z'), TZ)).toBe('2026-06-01')
    expect(exposureDay(new Date('2026-06-02T02:59:00Z'), TZ)).toBe('2026-06-01')
    expect(exposureDay(new Date('2026-06-02T03:00:00Z'), TZ)).toBe('2026-06-02')
  })
})

describe('buildTagImpact', () => {
  const hrv = new Map([
    ['2026-06-02', 30],
    ['2026-06-03', 50],
    ['2026-06-04', 32],
    ['2026-06-05', 48],
    ['2026-06-06', 52],
  ])
  const empty = new Map<string, number>()

  test('splits next-night outcomes into tagged and untagged nights; nights without a value drop out', () => {
    const [item] = buildTagImpact({
      minSamples: 2,
      occurrences: [
        {
          activity_type: 'tag_sleep_alcohol',
          display_name: null,
          start_time: new Date('2026-06-01T19:00:00Z'),
        },
        {
          activity_type: 'tag_sleep_alcohol',
          display_name: null,
          start_time: new Date('2026-06-01T21:00:00Z'),
        },
        {
          activity_type: 'tag_sleep_alcohol',
          display_name: null,
          start_time: new Date('2026-06-04T00:30:00Z'),
        },
        {
          activity_type: 'tag_sleep_alcohol',
          display_name: null,
          start_time: new Date('2026-06-07T19:00:00Z'),
        },
      ],
      outcomes: { hrv_sleep: hrv, resting_heart_rate: empty, sleep_score: empty },
      tz: TZ,
    })
    expect(item).toMatchObject({
      first_date: '2026-06-01',
      label: 'Alcohol',
      last_date: '2026-06-07',
      tag: 'tag_sleep_alcohol',
      tagged_days: 3,
    })
    const hrvOutcome = item!.outcomes.find((o) => o.metric === 'hrv_sleep')!
    expect(hrvOutcome).toMatchObject({
      difference: 31 - 50,
      enough_data: true,
      mean_with: 31,
      mean_without: 50,
      n_with: 2,
      n_without: 3,
    })
    expect(hrvOutcome.p_value).toBeGreaterThan(0)
    expect(hrvOutcome.p_value).toBeLessThan(0.05)
    expect(item!.outcomes.find((o) => o.metric === 'sleep_score')).toMatchObject({
      enough_data: false,
      mean_with: null,
      n_with: 0,
      n_without: 0,
      p_value: null,
    })
  })

  test('compares only with untagged nights within the control window of a tagged night', () => {
    const outcomes = new Map([
      ['2026-06-02', 20],
      ['2026-06-20', 40],
      ['2026-07-02', 44],
      ['2026-07-03', 99],
      ['2027-06-02', 99],
    ])
    const [item] = buildTagImpact({
      minSamples: 1,
      occurrences: [{ activity_type: 'x', display_name: 'X', start_time: new Date('2026-06-01T19:00:00Z') }],
      outcomes: { hrv_sleep: outcomes, resting_heart_rate: empty, sleep_score: empty },
      tz: TZ,
    })
    expect(item!.outcomes[0]).toMatchObject({ mean_with: 20, mean_without: 42, n_with: 1, n_without: 2 })
  })

  test('controlWakeDays spans the window around each following night', () => {
    const days = controlWakeDays(new Set(['2026-06-01']), 2)
    expect([...days].sort()).toEqual(['2026-05-31', '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'])
  })

  test('enough_data needs min_samples in both groups', () => {
    const [item] = buildTagImpact({
      occurrences: [{ activity_type: 'x', display_name: 'X', start_time: new Date('2026-06-01T19:00:00Z') }],
      outcomes: { hrv_sleep: hrv, resting_heart_rate: empty, sleep_score: empty },
      tz: TZ,
    })
    expect(item!.outcomes[0]!.enough_data).toBe(false)
  })

  test('sorts by tagged days, then label', () => {
    const at = (type: string, iso: string) => ({
      activity_type: type,
      display_name: null,
      start_time: new Date(iso),
    })
    const out = buildTagImpact({
      occurrences: [
        at('tag_generic_b', '2026-06-01T19:00:00Z'),
        at('tag_generic_a', '2026-06-01T19:00:00Z'),
        at('tag_generic_c', '2026-06-01T19:00:00Z'),
        at('tag_generic_c', '2026-06-02T19:00:00Z'),
      ],
      outcomes: { hrv_sleep: empty, resting_heart_rate: empty, sleep_score: empty },
      tz: TZ,
    })
    expect(out.map((t) => t.label)).toEqual(['C', 'A', 'B'])
  })
})
