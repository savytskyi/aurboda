import { describe, expect, test, vi } from 'vitest'

import { backfillOuraDerivedMetricsForUsers, contributorPointsFromRecords } from './oura-backfill.ts'

const row = (data: Record<string, unknown>) => ({
  data,
  id: 'r',
  recorded_at: new Date('2026-06-01T00:00:00Z'),
})

describe('contributorPointsFromRecords', () => {
  test('stamps contributor points at the document timestamp and skips undated or contributor-less documents', () => {
    const points = contributorPointsFromRecords([
      row({
        contributors: { meet_daily_targets: 60, stay_active: null, training_volume: 98 },
        day: '2026-06-01',
        timestamp: '2026-06-01T04:00:00+02:00',
      }),
      row({ contributors: { stay_active: 50 } }),
      row({ day: '2026-06-02' }),
    ])
    expect(points).toEqual([
      {
        metric: 'activity_meet_daily_targets',
        source: 'oura',
        time: new Date('2026-06-01T02:00:00Z'),
        value: 60,
      },
      {
        metric: 'activity_training_volume',
        source: 'oura',
        time: new Date('2026-06-01T02:00:00Z'),
        value: 98,
      },
    ])
  })
})

describe('backfillOuraDerivedMetricsForUsers', () => {
  test('backfills only users that need it, sequentially, and logs failures without throwing', async () => {
    const calls: string[] = []
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await backfillOuraDerivedMetricsForUsers(['a', 'b', 'c'], {
      backfill: async (user) => {
        calls.push(user)
        if (user === 'b') throw new Error('boom')
        return { daily_activity_records: 1, points_written: 6 }
      },
      needs: async (user) => user !== 'c',
    })
    expect(calls).toEqual(['a', 'b'])
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
    info.mockRestore()
  })
})
