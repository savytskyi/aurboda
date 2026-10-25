import {
  healthDailyQuerySchema,
  healthOverviewQuerySchema,
  sleepScheduleQuerySchema,
  tagImpactQuerySchema,
} from '@aurboda/api-spec'

import {
  backfillOuraDerivedMetrics,
  getHealthDaily,
  getHealthOverview,
  getSleepSchedule,
  getTagImpact,
  parseIntParam,
  resolveHealthTz,
} from '../services/health/index.ts'
import { jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

const ESTIMATES_NOTE =
  'Values are consumer-wearable (Oura) estimates compared with the user’s own trailing baseline ("your normal"); ' +
  'they are not medical measurements and nothing here is a diagnosis.'

const failure = (error: unknown) =>
  jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error', success: false })

export const registerHealthTools = (server: McpServer, user: string) => {
  server.tool(
    'get_health_overview',
    `Health dashboard summary for one day: readiness, sleep and activity scores against the 30-day personal normal
(with their weakest contributors), the overnight recovery signals (nightly HRV, resting HR, temperature deviation,
respiratory rate) as z-scores against that normal, stress and resilience, age, and up to three plain-language
insights. ${ESTIMATES_NOTE}

Example: "How did I recover last night?" → no arguments (today in the user's timezone).`,
    { ...healthOverviewQuerySchema.shape },
    async ({ date, tz }) => {
      try {
        const zone = await resolveHealthTz(user, tz)
        return tzJsonResponse(
          { data: await getHealthOverview(user, { date, tz: zone }), success: true },
          zone,
        )
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.tool(
    'get_health_daily',
    `Per-day history of health metrics (one value per local day; per-night values belong to the wake day), each day
with its personal normal: mean and SD of the previous baseline_days (default 30). Metrics are the health metric
catalogue: readiness_score, sleep_score, activity_score and their contributors, hrv_sleep (Oura's nightly average),
resting_heart_rate (lowest overnight), temperature_deviation, respiratory_rate, sleep_*, steps, stress_high_sec,
resilience_score, and more. ${ESTIMATES_NOTE}

Example: "My HRV and resting HR over the last 3 months" → metrics: "hrv_sleep,resting_heart_rate", start, end.`,
    { ...healthDailyQuerySchema.shape },
    async ({ baseline_days, end, metrics, start, tz }) => {
      try {
        const zone = await resolveHealthTz(user, tz)
        const data = await getHealthDaily(user, {
          baselineDays: parseIntParam(baseline_days, 30),
          end,
          metrics: metrics
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean),
          start,
          tz: zone,
        })
        return tzJsonResponse({ data, success: true }, zone)
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.tool(
    'get_sleep_schedule',
    `Bedtime and wake time of each main sleep (by local wake day) with their mean and spread, plus Oura's latest
bedtime recommendation and optimal bedtime window. Clock values are minutes after local midnight; bedtimes before
noon are pushed past 1440 (00:30 = 1470). ${ESTIMATES_NOTE}`,
    { ...sleepScheduleQuerySchema.shape },
    async ({ end, start, tz }) => {
      try {
        const zone = await resolveHealthTz(user, tz)
        return tzJsonResponse(
          { data: await getSleepSchedule(user, { end, start, tz: zone }), success: true },
          zone,
        )
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.tool(
    'get_tag_impact',
    `For each Oura lifestyle tag (alcohol, late meal, custom tags, …): the next night's nightly HRV, sleep score and
resting HR after tagged days against all other nights, with Welch p-value and Cohen's d. This is correlational —
it shows association, not cause, and small samples (enough_data false) are unreliable. ${ESTIMATES_NOTE}`,
    { ...tagImpactQuerySchema.shape },
    async ({ days, tz }) => {
      try {
        const zone = await resolveHealthTz(user, tz)
        const data = await getTagImpact(user, { days: parseIntParam(days, 1095), tz: zone })
        return tzJsonResponse({ data, success: true }, zone)
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.tool(
    'backfill_oura_metrics',
    'Re-derive the Oura activity-score contributor metrics (activity_stay_active, …) from the stored Oura daily_activity documents. Idempotent; no Oura API calls.',
    {},
    async () => {
      try {
        return jsonResponse({ data: await backfillOuraDerivedMetrics(user), success: true })
      } catch (error) {
        return failure(error)
      }
    },
  )
}
