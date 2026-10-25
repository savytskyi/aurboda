import type { RequestHandler, Response } from 'express'

import {
  type HealthDailyQuery,
  healthDailyQuerySchema,
  type HealthDailyResponse,
  type HealthOverviewQuery,
  healthOverviewQuerySchema,
  type HealthOverviewResponse,
  type OuraMetricBackfillResponse,
  type SleepScheduleQuery,
  sleepScheduleQuerySchema,
  type SleepScheduleResponse,
  type TagImpactQuery,
  tagImpactQuerySchema,
  type TagImpactResponse,
} from '@aurboda/api-spec'

import { isHttpError } from '../http-error.ts'
import {
  backfillOuraDerivedMetrics,
  getHealthDaily,
  getHealthOverview,
  getSleepSchedule,
  getTagImpact,
  parseIntParam,
  resolveHealthTz,
} from '../services/health/index.ts'
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateQuery } from '../validation.ts'

/** Client errors (bad metric, range, timezone) become `{ success: false, error }`; anything else propagates. */
const withClientErrors = async (
  res: Response<{ success: boolean; error?: string }>,
  run: () => Promise<void>,
): Promise<void> => {
  try {
    await run()
  } catch (error) {
    if (isHttpError(error) && error.status < 500) {
      res.status(error.status).json({ error: error.message, success: false })
      return
    }
    throw error
  }
}

export const createHealthRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, HealthOverviewResponse, unknown, HealthOverviewQuery>(
    '/overview',
    authMiddleware,
    validateQuery(healthOverviewQuerySchema),
    async (req, res) => {
      await withClientErrors(res, async () => {
        const tz = await resolveHealthTz(req.user!, req.query.tz)
        res.json({ data: await getHealthOverview(req.user!, { date: req.query.date, tz }), success: true })
      })
    },
  )

  router.get<Record<string, never>, HealthDailyResponse, unknown, HealthDailyQuery>(
    '/daily',
    authMiddleware,
    validateQuery(healthDailyQuerySchema),
    async (req, res) => {
      await withClientErrors(res, async () => {
        const tz = await resolveHealthTz(req.user!, req.query.tz)
        const metrics = req.query.metrics
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
        const data = await getHealthDaily(req.user!, {
          baselineDays: parseIntParam(req.query.baseline_days, 30),
          end: req.query.end,
          metrics,
          start: req.query.start,
          tz,
        })
        res.json({ data, success: true })
      })
    },
  )

  router.get<Record<string, never>, SleepScheduleResponse, unknown, SleepScheduleQuery>(
    '/sleep-schedule',
    authMiddleware,
    validateQuery(sleepScheduleQuerySchema),
    async (req, res) => {
      await withClientErrors(res, async () => {
        const tz = await resolveHealthTz(req.user!, req.query.tz)
        const data = await getSleepSchedule(req.user!, { end: req.query.end, start: req.query.start, tz })
        res.json({ data, success: true })
      })
    },
  )

  router.get<Record<string, never>, TagImpactResponse, unknown, TagImpactQuery>(
    '/tag-impact',
    authMiddleware,
    validateQuery(tagImpactQuerySchema),
    async (req, res) => {
      await withClientErrors(res, async () => {
        const tz = await resolveHealthTz(req.user!, req.query.tz)
        const data = await getTagImpact(req.user!, { days: parseIntParam(req.query.days, 1095), tz })
        res.json({ data, success: true })
      })
    },
  )

  router.post<Record<string, never>, OuraMetricBackfillResponse>(
    '/backfill-oura',
    authMiddleware,
    async (req, res) => {
      res.json({ data: await backfillOuraDerivedMetrics(req.user!), success: true })
    },
  )

  return router
}
