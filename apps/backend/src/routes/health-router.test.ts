import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { httpError } from '../http-error.ts'
import { createHealthRouter } from './health-router.ts'

vi.mock('../services/health/index.ts', () => ({
  backfillOuraDerivedMetrics: vi.fn(),
  getHealthDaily: vi.fn(),
  getHealthOverview: vi.fn(),
  getSleepSchedule: vi.fn(),
  getTagImpact: vi.fn(),
  parseIntParam: (raw: string | undefined, fallback: number) => (raw ? Number(raw) : fallback),
  resolveHealthTz: vi.fn(async (_user: string, tz: string | undefined) => {
    if (tz === 'Mars/Base') throw Object.assign(new Error('Unknown timezone: Mars/Base'), { status: 400 })
    return tz ?? 'Europe/Ljubljana'
  }),
}))

const service = await import('../services/health/index.ts')

const buildApp = (user?: string) => {
  const app = express()
  app.use(express.json())
  const auth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!user) {
      res.status(401).json({ error: 'Unauthorized', success: false })
      return
    }
    req.user = user
    next()
  }
  app.use(createHealthRouter(auth) as unknown as express.RequestHandler)
  return app
}

describe('health router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each([
    ['get', '/overview'],
    ['get', '/daily?metrics=hrv_sleep&start=2026-01-01&end=2026-01-31'],
    ['get', '/sleep-schedule?start=2026-01-01&end=2026-01-31'],
    ['get', '/tag-impact'],
    ['post', '/backfill-oura'],
  ] as const)('%s %s requires authentication', async (method, path) => {
    const res = await supertest(buildApp())[method](path)
    expect(res.status).toBe(401)
  })

  test('overview resolves the timezone and passes the date', async () => {
    vi.mocked(service.getHealthOverview).mockResolvedValue({ date: '2026-10-20' } as never)
    const res = await supertest(buildApp('ky')).get('/overview?date=2026-10-20')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { date: '2026-10-20' }, success: true })
    expect(service.getHealthOverview).toHaveBeenCalledWith('ky', {
      date: '2026-10-20',
      tz: 'Europe/Ljubljana',
    })
  })

  test('daily splits metrics and parses baseline_days', async () => {
    vi.mocked(service.getHealthDaily).mockResolvedValue({ series: [] } as never)
    const res = await supertest(buildApp('ky')).get(
      '/daily?metrics=hrv_sleep,%20resting_heart_rate&start=2026-01-01&end=2026-01-31&baseline_days=60&tz=UTC',
    )
    expect(res.status).toBe(200)
    expect(service.getHealthDaily).toHaveBeenCalledWith('ky', {
      baselineDays: 60,
      end: '2026-01-31',
      metrics: ['hrv_sleep', 'resting_heart_rate'],
      start: '2026-01-01',
      tz: 'UTC',
    })
  })

  test('daily rejects a malformed query before the service', async () => {
    const res = await supertest(buildApp('ky')).get('/daily?metrics=hrv_sleep&start=2026-1-1&end=2026-01-31')
    expect(res.status).toBe(400)
    expect(res.body.success).toBe(false)
    expect(service.getHealthDaily).not.toHaveBeenCalled()
  })

  test('service validation errors become 400 with the message', async () => {
    vi.mocked(service.getHealthDaily).mockRejectedValue(httpError(400, 'Unknown health metrics: bogus'))
    const res = await supertest(buildApp('ky')).get('/daily?metrics=bogus&start=2026-01-01&end=2026-01-31')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Unknown health metrics: bogus', success: false })
  })

  test('an unknown timezone is a 400', async () => {
    const res = await supertest(buildApp('ky')).get('/tag-impact?tz=Mars/Base')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Unknown timezone: Mars/Base', success: false })
    expect(service.getTagImpact).not.toHaveBeenCalled()
  })

  test('sleep schedule and tag impact pass their parameters', async () => {
    vi.mocked(service.getSleepSchedule).mockResolvedValue({ nights: [] } as never)
    vi.mocked(service.getTagImpact).mockResolvedValue({ tags: [] } as never)
    await supertest(buildApp('ky')).get('/sleep-schedule?start=2026-01-01&end=2026-01-31').expect(200)
    await supertest(buildApp('ky')).get('/tag-impact?days=365').expect(200)
    expect(service.getSleepSchedule).toHaveBeenCalledWith('ky', {
      end: '2026-01-31',
      start: '2026-01-01',
      tz: 'Europe/Ljubljana',
    })
    expect(service.getTagImpact).toHaveBeenCalledWith('ky', { days: 365, tz: 'Europe/Ljubljana' })
  })

  test('backfill runs for the authenticated user', async () => {
    vi.mocked(service.backfillOuraDerivedMetrics).mockResolvedValue({
      daily_activity_records: 3,
      points_written: 18,
    })
    const res = await supertest(buildApp('ky')).post('/backfill-oura')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ data: { daily_activity_records: 3, points_written: 18 }, success: true })
    expect(service.backfillOuraDerivedMetrics).toHaveBeenCalledWith('ky')
  })
})
