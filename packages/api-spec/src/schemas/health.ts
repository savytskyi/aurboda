/**
 * Health dashboard schemas: the Home overview, per-day histories with a
 * personal-normal band, the sleep schedule, and lifestyle-tag impact.
 *
 * Days are local calendar days in the request's `tz`. Oura stamps each daily
 * document inside the local day it belongs to, and per-night values (resting
 * HR, nightly HRV, sleep totals) at wake time, so a night belongs to the day
 * you woke up on.
 */

import { z } from 'zod'

import { createDataResponseSchema, dateOnlySchema, iso8601DateTimeSchema, type MetricType } from './common.ts'

/** Whether a higher value is the favorable direction for a metric. */
export type HealthMetricDirection = 'higher' | 'lower' | 'neutral'

export interface HealthMetricInfo {
  label: string
  /** Stored unit (seconds stay seconds; the client formats them). */
  unit: string
  direction: HealthMetricDirection
}

const score = (label: string, direction: HealthMetricDirection = 'higher'): HealthMetricInfo => ({
  direction,
  label,
  unit: 'score',
})

/**
 * The daily health metrics the dashboard reads, with one display label each.
 * Contributor scores (0-100) are labelled "score" so they never read as the
 * underlying measurement (`sleep_efficiency` is a score; `sleep_efficiency_percent`
 * is the percentage).
 */
export const healthMetricCatalog = {
  readiness_score: score('Readiness'),
  sleep_score: score('Sleep score'),
  activity_score: score('Activity score'),

  readiness_activity_balance: score('Activity balance'),
  readiness_body_temperature: score('Body temperature'),
  readiness_hrv_balance: score('HRV balance'),
  readiness_previous_day_activity: score('Previous day activity'),
  readiness_previous_night: score('Previous night'),
  readiness_recovery_index: score('Recovery index'),
  readiness_resting_heart_rate: score('Resting heart rate'),
  readiness_sleep_balance: score('Sleep balance'),
  readiness_sleep_regularity: score('Sleep regularity'),

  sleep_total_score: score('Total sleep'),
  sleep_efficiency: score('Efficiency'),
  sleep_restfulness: score('Restfulness'),
  sleep_rem_score: score('REM sleep'),
  sleep_deep_score: score('Deep sleep'),
  sleep_latency: score('Latency'),
  sleep_timing: score('Timing'),

  activity_stay_active: score('Stay active'),
  activity_move_every_hour: score('Move every hour'),
  activity_meet_daily_targets: score('Meet daily targets'),
  activity_training_frequency: score('Training frequency'),
  activity_training_volume: score('Training volume'),
  activity_recovery_time: score('Recovery time'),

  hrv_sleep: { direction: 'higher', label: 'Nightly HRV', unit: 'ms' },
  resting_heart_rate: { direction: 'lower', label: 'Resting HR (lowest overnight)', unit: 'bpm' },
  sleep_average_heart_rate: { direction: 'lower', label: 'Average overnight HR', unit: 'bpm' },
  temperature_deviation: { direction: 'neutral', label: 'Temperature deviation', unit: 'celsius' },
  temperature_trend_deviation: { direction: 'neutral', label: 'Temperature trend', unit: 'celsius' },
  respiratory_rate: { direction: 'neutral', label: 'Respiratory rate', unit: 'brpm' },
  spo2: { direction: 'higher', label: 'Average SpO₂', unit: 'percent' },
  breathing_disturbance_index: { direction: 'lower', label: 'Breathing disturbance index', unit: 'index' },

  sleep_duration_sec: { direction: 'higher', label: 'Total sleep', unit: 'sec' },
  time_in_bed_sec: { direction: 'neutral', label: 'Time in bed', unit: 'sec' },
  sleep_deep_sec: { direction: 'neutral', label: 'Deep', unit: 'sec' },
  sleep_rem_sec: { direction: 'neutral', label: 'REM', unit: 'sec' },
  sleep_light_sec: { direction: 'neutral', label: 'Light', unit: 'sec' },
  sleep_awake_sec: { direction: 'lower', label: 'Awake', unit: 'sec' },
  sleep_efficiency_percent: { direction: 'higher', label: 'Sleep efficiency', unit: '%' },
  sleep_latency_sec: { direction: 'lower', label: 'Time to fall asleep', unit: 'sec' },
  sleep_restless_periods: { direction: 'lower', label: 'Restless periods', unit: 'count' },

  steps: { direction: 'higher', label: 'Steps', unit: 'count' },
  equivalent_walking_distance: { direction: 'higher', label: 'Walking-equivalent distance', unit: 'm' },
  activity_target_meters: { direction: 'neutral', label: 'Daily target', unit: 'm' },
  meters_to_target: { direction: 'lower', label: 'Left to target', unit: 'm' },
  activity_calories_active: { direction: 'higher', label: 'Active calories', unit: 'kcal' },
  activity_calories_total: { direction: 'neutral', label: 'Total calories', unit: 'kcal' },
  activity_target_calories: { direction: 'neutral', label: 'Active calorie target', unit: 'kcal' },
  high_activity_time_sec: { direction: 'higher', label: 'High intensity', unit: 'sec' },
  medium_activity_time_sec: { direction: 'higher', label: 'Medium intensity', unit: 'sec' },
  low_activity_time_sec: { direction: 'neutral', label: 'Low intensity', unit: 'sec' },
  sedentary_time_sec: { direction: 'lower', label: 'Sedentary', unit: 'sec' },
  resting_time_sec: { direction: 'neutral', label: 'Resting', unit: 'sec' },
  non_wear_time_sec: { direction: 'neutral', label: 'Not worn', unit: 'sec' },
  inactivity_alerts: { direction: 'lower', label: 'Inactivity alerts', unit: 'count' },

  stress_high_sec: { direction: 'lower', label: 'High stress', unit: 'sec' },
  recovery_high_sec: { direction: 'higher', label: 'Restorative time', unit: 'sec' },
  stress_day_summary: { direction: 'lower', label: 'Day summary', unit: 'level' },
  resilience_score: score('Resilience'),
  resilience_sleep_recovery: score('Sleep recovery'),
  resilience_daytime_recovery: score('Daytime recovery'),
  resilience_stress: score('Stress load'),

  cardiovascular_age: { direction: 'lower', label: 'Cardiovascular age', unit: 'years' },
  pulse_wave_velocity: { direction: 'lower', label: 'Pulse wave velocity', unit: 'm/s' },
  vo2_max: { direction: 'higher', label: 'VO₂ max', unit: 'mL/kg/min' },
} as const satisfies Partial<Record<MetricType, HealthMetricInfo>>

export type HealthMetric = keyof typeof healthMetricCatalog

export const healthMetrics = Object.keys(healthMetricCatalog) as HealthMetric[]

export const isHealthMetric = (metric: string): metric is HealthMetric => metric in healthMetricCatalog

export const readinessContributorMetrics = [
  'readiness_previous_night',
  'readiness_sleep_balance',
  'readiness_sleep_regularity',
  'readiness_previous_day_activity',
  'readiness_activity_balance',
  'readiness_body_temperature',
  'readiness_resting_heart_rate',
  'readiness_hrv_balance',
  'readiness_recovery_index',
] as const satisfies readonly HealthMetric[]

export const sleepContributorMetrics = [
  'sleep_total_score',
  'sleep_efficiency',
  'sleep_restfulness',
  'sleep_rem_score',
  'sleep_deep_score',
  'sleep_latency',
  'sleep_timing',
] as const satisfies readonly HealthMetric[]

export const activityContributorMetrics = [
  'activity_stay_active',
  'activity_move_every_hour',
  'activity_meet_daily_targets',
  'activity_training_frequency',
  'activity_training_volume',
  'activity_recovery_time',
] as const satisfies readonly HealthMetric[]

/** Oura resilience levels, ascending, as stored in `resilience_score`. */
export const resilienceLevels = ['limited', 'adequate', 'solid', 'strong', 'exceptional'] as const
export type ResilienceLevel = (typeof resilienceLevels)[number]

const tzQuerySchema = z.string().optional().meta({
  description: 'IANA timezone the days are counted in (defaults to the user timezone setting, else UTC)',
  example: 'Europe/Ljubljana',
})

export const healthBaselineSchema = z
  .object({
    mean: z.number().meta({ description: 'Mean of the trailing window (the day itself excluded)' }),
    n: z.number().int().meta({ description: 'Days with a value in the trailing window' }),
    sd: z.number().meta({ description: 'Sample standard deviation of the trailing window' }),
  })
  .meta({
    description:
      'Personal normal: the trailing `baseline_days` before a day. Null when fewer than `min_baseline_days` values exist.',
    id: 'HealthBaseline',
  })

export type HealthBaseline = z.infer<typeof healthBaselineSchema>

// ---------------------------------------------------------------------------
// Daily history
// ---------------------------------------------------------------------------

export const healthDailyQuerySchema = z
  .object({
    baseline_days: z.string().regex(/^\d+$/).optional().meta({
      description: 'Trailing window for the personal-normal band, in days (7-180, default 30)',
      example: '30',
    }),
    end: dateOnlySchema.meta({ description: 'Last day (inclusive)' }),
    metrics: z.string().min(1).meta({
      description: 'Comma-separated health metrics (see healthMetricCatalog)',
      example: 'hrv_sleep,resting_heart_rate',
    }),
    start: dateOnlySchema.meta({ description: 'First day (inclusive); at most 3660 days before `end`' }),
    tz: tzQuerySchema,
  })
  .meta({ id: 'HealthDailyQuery' })

export type HealthDailyQuery = z.infer<typeof healthDailyQuerySchema>

export const healthDailyPointSchema = z
  .object({
    baseline: healthBaselineSchema.nullable(),
    date: dateOnlySchema,
    value: z.number(),
  })
  .meta({ id: 'HealthDailyPoint' })

export type HealthDailyPoint = z.infer<typeof healthDailyPointSchema>

export const healthDailySeriesSchema = z
  .object({
    metric: z.string(),
    points: z.array(healthDailyPointSchema).meta({ description: 'Days with a value, ascending' }),
    unit: z.string(),
  })
  .meta({ id: 'HealthDailySeries' })

export type HealthDailySeries = z.infer<typeof healthDailySeriesSchema>

export const healthDailyDataSchema = z
  .object({
    baseline_days: z.number().int(),
    end: dateOnlySchema,
    min_baseline_days: z.number().int(),
    series: z.array(healthDailySeriesSchema),
    start: dateOnlySchema,
    tz: z.string(),
  })
  .meta({ id: 'HealthDailyData' })

export type HealthDailyData = z.infer<typeof healthDailyDataSchema>

export const healthDailyResponseSchema = createDataResponseSchema(healthDailyDataSchema).meta({
  id: 'HealthDailyResponse',
})

export type HealthDailyResponse = z.infer<typeof healthDailyResponseSchema>

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const healthOverviewQuerySchema = z
  .object({
    date: dateOnlySchema.optional().meta({ description: 'Day to summarise (defaults to today in tz)' }),
    tz: tzQuerySchema,
  })
  .meta({ id: 'HealthOverviewQuery' })

export type HealthOverviewQuery = z.infer<typeof healthOverviewQuerySchema>

export const healthValueSchema = z
  .object({ metric: z.string(), value: z.number() })
  .meta({ id: 'HealthValue' })

export type HealthValue = z.infer<typeof healthValueSchema>

export const healthScoreSummarySchema = z
  .object({
    baseline: healthBaselineSchema.nullable(),
    date: dateOnlySchema.nullable().meta({ description: 'Day the value belongs to (null when missing)' }),
    delta: z.number().nullable().meta({ description: 'value − baseline mean' }),
    details: z.array(healthValueSchema).meta({
      description:
        'Context values for the same day: readiness → none; sleep → sleep_duration_sec, sleep_efficiency_percent; activity → steps, equivalent_walking_distance, activity_target_meters',
    }),
    metric: z.string(),
    value: z.number().nullable(),
    weakest_contributors: z.array(healthValueSchema).meta({
      description: 'Up to two contributor scores below 70 for that day, lowest first',
    }),
  })
  .meta({ id: 'HealthScoreSummary' })

export type HealthScoreSummary = z.infer<typeof healthScoreSummarySchema>

export const healthSignalStatusSchema = z
  .enum(['normal', 'above', 'below', 'insufficient_data', 'missing'])
  .meta({
    description:
      'above/below: at least 1.5 SD from the personal normal; insufficient_data: too little history for a normal; missing: no value in the last 3 days',
    id: 'HealthSignalStatus',
  })

export type HealthSignalStatus = z.infer<typeof healthSignalStatusSchema>

export const healthSignalSummarySchema = z
  .object({
    baseline: healthBaselineSchema.nullable(),
    date: dateOnlySchema.nullable(),
    delta: z.number().nullable().meta({ description: 'value − baseline mean' }),
    favorable: z.boolean().nullable().meta({
      description: 'Whether the deviation is in the good direction; null for neutral metrics or no deviation',
    }),
    metric: z.string(),
    status: healthSignalStatusSchema,
    value: z.number().nullable(),
    z: z.number().nullable().meta({ description: '(value − mean) / sd' }),
  })
  .meta({ id: 'HealthSignalSummary' })

export type HealthSignalSummary = z.infer<typeof healthSignalSummarySchema>

export const stressDaySummarySchema = z
  .enum(['restored', 'normal', 'stressful'])
  .meta({ id: 'StressDaySummary' })
export type StressDaySummary = z.infer<typeof stressDaySummarySchema>

export const healthStressSummarySchema = z
  .object({
    date: dateOnlySchema.nullable().meta({ description: 'Day of the stress/recovery totals' }),
    day_summary: stressDaySummarySchema.nullable(),
    day_summary_date: dateOnlySchema
      .nullable()
      .meta({ description: 'Most recent day Oura has summarised (today is usually not yet)' }),
    is_partial_day: z
      .boolean()
      .meta({ description: 'True when the totals are for today, still accumulating' }),
    recovery_high_sec: z.number().nullable(),
    resilience: z
      .object({
        contributors: z.object({
          daytime_recovery: z.number().nullable(),
          sleep_recovery: z.number().nullable(),
          stress: z.number().nullable(),
        }),
        date: dateOnlySchema.nullable(),
        level: z.enum(resilienceLevels).nullable(),
        previous_level: z.enum(resilienceLevels).nullable().meta({ description: 'Level 14 days earlier' }),
      })
      .meta({ id: 'HealthResilienceSummary' }),
    stress_high_sec: z.number().nullable(),
    stressful_days_last_7: z
      .number()
      .int()
      .meta({ description: 'Days summarised "stressful" in the last 7' }),
  })
  .meta({ id: 'HealthStressSummary' })

export type HealthStressSummary = z.infer<typeof healthStressSummarySchema>

export const healthInsightSeveritySchema = z
  .enum(['alert', 'watch', 'info', 'positive'])
  .meta({ id: 'HealthInsightSeverity' })

export type HealthInsightSeverity = z.infer<typeof healthInsightSeveritySchema>

export const healthInsightSchema = z
  .object({
    detail: z.string(),
    href: z.string().meta({ description: 'Web path of the page that explains it' }),
    id: z.string().meta({ description: 'Stable rule id, e.g. "hrv_low"' }),
    metrics: z.array(z.string()),
    severity: healthInsightSeveritySchema,
    title: z.string(),
  })
  .meta({ id: 'HealthInsight' })

export type HealthInsight = z.infer<typeof healthInsightSchema>

export const healthAgeSchema = z
  .object({
    as_of: dateOnlySchema.meta({ description: 'Day the age is computed for' }),
    source: z.enum(['birth_date', 'oura_personal_info']),
    years: z.number().meta({ description: 'Whole years' }),
  })
  .meta({
    description:
      'Chronological age, from the birth_date setting, else from the age in the latest Oura personal_info document advanced by the time since it was fetched',
    id: 'HealthAge',
  })

export type HealthAge = z.infer<typeof healthAgeSchema>

export const healthOverviewDataSchema = z
  .object({
    age: healthAgeSchema.nullable(),
    date: dateOnlySchema,
    insights: z.array(healthInsightSchema).meta({ description: 'At most three, most important first' }),
    last_sleep_date: dateOnlySchema.nullable().meta({ description: 'Wake day of the latest main sleep' }),
    scores: z.object({
      activity: healthScoreSummarySchema,
      readiness: healthScoreSummarySchema,
      sleep: healthScoreSummarySchema,
    }),
    signals: z.array(healthSignalSummarySchema).meta({
      description: 'hrv_sleep, resting_heart_rate, temperature_deviation, respiratory_rate, in that order',
    }),
    stress: healthStressSummarySchema,
    tz: z.string(),
  })
  .meta({ id: 'HealthOverviewData' })

export type HealthOverviewData = z.infer<typeof healthOverviewDataSchema>

export const healthOverviewResponseSchema = createDataResponseSchema(healthOverviewDataSchema).meta({
  id: 'HealthOverviewResponse',
})

export type HealthOverviewResponse = z.infer<typeof healthOverviewResponseSchema>

// ---------------------------------------------------------------------------
// Sleep schedule
// ---------------------------------------------------------------------------

/**
 * Clock positions are minutes after local midnight; a bedtime before noon is
 * pushed past 1440 so a night that starts at 00:30 (1470) sorts after 23:30
 * (1410). Oura's optimal-bedtime offsets use the same scale.
 */
export const sleepScheduleQuerySchema = z
  .object({
    end: dateOnlySchema.meta({ description: 'Last wake day (inclusive)' }),
    start: dateOnlySchema.meta({ description: 'First wake day (inclusive); at most 400 days before `end`' }),
    tz: tzQuerySchema,
  })
  .meta({ id: 'SleepScheduleQuery' })

export type SleepScheduleQuery = z.infer<typeof sleepScheduleQuerySchema>

export const sleepScheduleNightSchema = z
  .object({
    bedtime_clock_min: z.number().meta({ description: 'Bedtime on the clock scale (e.g. 1350 = 22:30)' }),
    bedtime_end: iso8601DateTimeSchema,
    bedtime_start: iso8601DateTimeSchema,
    date: dateOnlySchema.meta({ description: 'Local wake day' }),
    wake_clock_min: z.number().meta({ description: 'Wake time, minutes after local midnight' }),
  })
  .meta({ id: 'SleepScheduleNight' })

export type SleepScheduleNight = z.infer<typeof sleepScheduleNightSchema>

export const optimalBedtimeSchema = z
  .object({
    date: dateOnlySchema,
    end_clock_min: z.number(),
    start_clock_min: z.number(),
  })
  .meta({ description: 'Oura optimal bedtime window', id: 'OptimalBedtime' })

export type OptimalBedtime = z.infer<typeof optimalBedtimeSchema>

export const bedtimeRecommendationSchema = z
  .object({
    date: dateOnlySchema,
    last_optimal: optimalBedtimeSchema
      .nullable()
      .meta({ description: 'Most recent day Oura found an optimal window, if not the latest day' }),
    optimal: optimalBedtimeSchema.nullable(),
    recommendation: z
      .string()
      .nullable()
      .meta({ description: 'Oura code: earlier_bedtime, later_bedtime, follow_optimal_bedtime, …' }),
    status: z
      .string()
      .meta({ description: 'Oura code: optimal_found, only_recommended_found, not_enough_nights, …' }),
  })
  .meta({ id: 'BedtimeRecommendation' })

export type BedtimeRecommendation = z.infer<typeof bedtimeRecommendationSchema>

export const sleepScheduleDataSchema = z
  .object({
    nights: z.array(sleepScheduleNightSchema),
    recommendation: bedtimeRecommendationSchema.nullable(),
    stats: z.object({
      bedtime_mean_clock_min: z.number().nullable(),
      bedtime_sd_min: z.number().nullable(),
      n: z.number().int(),
      wake_mean_clock_min: z.number().nullable(),
      wake_sd_min: z.number().nullable(),
    }),
    tz: z.string(),
  })
  .meta({ id: 'SleepScheduleData' })

export type SleepScheduleData = z.infer<typeof sleepScheduleDataSchema>

export const sleepScheduleResponseSchema = createDataResponseSchema(sleepScheduleDataSchema).meta({
  id: 'SleepScheduleResponse',
})

export type SleepScheduleResponse = z.infer<typeof sleepScheduleResponseSchema>

// ---------------------------------------------------------------------------
// Lifestyle tag impact
// ---------------------------------------------------------------------------

export const tagImpactOutcomeMetrics = ['hrv_sleep', 'sleep_score', 'resting_heart_rate'] as const

export const tagImpactQuerySchema = z
  .object({
    days: z.string().regex(/^\d+$/).optional().meta({
      description: 'Look-back window in days (30-3650, default 1095)',
      example: '1095',
    }),
    tz: tzQuerySchema,
  })
  .meta({ id: 'TagImpactQuery' })

export type TagImpactQuery = z.infer<typeof tagImpactQuerySchema>

export const tagImpactOutcomeSchema = z
  .object({
    cohens_d: z.number().nullable(),
    difference: z.number().nullable().meta({ description: 'mean_with − mean_without' }),
    enough_data: z.boolean().meta({ description: 'n_with ≥ min_samples and n_without ≥ min_samples' }),
    mean_with: z.number().nullable(),
    mean_without: z.number().nullable().meta({
      description: 'Mean over untagged nights within 30 days of a tagged night',
    }),
    metric: z.enum(tagImpactOutcomeMetrics),
    n_with: z.number().int(),
    n_without: z.number().int(),
    p_value: z.number().nullable().meta({ description: 'Welch t-test, two-sided' }),
  })
  .meta({ id: 'TagImpactOutcome' })

export type TagImpactOutcome = z.infer<typeof tagImpactOutcomeSchema>

export const tagImpactItemSchema = z
  .object({
    first_date: dateOnlySchema,
    label: z.string(),
    last_date: dateOnlySchema,
    outcomes: z.array(tagImpactOutcomeSchema),
    tag: z.string().meta({ description: 'Activity type the Oura tag is stored as' }),
    tagged_days: z.number().int().meta({ description: 'Distinct days carrying the tag' }),
  })
  .meta({ id: 'TagImpactItem' })

export type TagImpactItem = z.infer<typeof tagImpactItemSchema>

export const tagImpactDataSchema = z
  .object({
    end: dateOnlySchema,
    min_samples: z.number().int(),
    start: dateOnlySchema,
    tags: z.array(tagImpactItemSchema).meta({ description: 'Most-tagged first' }),
    tz: z.string(),
  })
  .meta({ id: 'TagImpactData' })

export type TagImpactData = z.infer<typeof tagImpactDataSchema>

export const tagImpactResponseSchema = createDataResponseSchema(tagImpactDataSchema).meta({
  id: 'TagImpactResponse',
})

export type TagImpactResponse = z.infer<typeof tagImpactResponseSchema>

// ---------------------------------------------------------------------------
// Backfill from stored Oura raw records
// ---------------------------------------------------------------------------

export const ouraMetricBackfillDataSchema = z
  .object({
    daily_activity_records: z.number().int().meta({ description: 'Stored daily_activity documents read' }),
    points_written: z.number().int().meta({ description: 'Metric points upserted' }),
  })
  .meta({ id: 'OuraMetricBackfillData' })

export type OuraMetricBackfillData = z.infer<typeof ouraMetricBackfillDataSchema>

export const ouraMetricBackfillResponseSchema = createDataResponseSchema(ouraMetricBackfillDataSchema).meta({
  id: 'OuraMetricBackfillResponse',
})

export type OuraMetricBackfillResponse = z.infer<typeof ouraMetricBackfillResponseSchema>
