import { z } from 'zod'

import {
  activityTypeSchema,
  baseResponseSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  hrZoneSourceSchema,
  iso8601DateTimeSchema,
} from './common.ts'
import { hrZoneSecsSchema } from './settings.ts'

/**
 * Set kinds, spelled as the Gravl import stores them so manual and Gravl sets
 * share one shape. A "working" set is `normal`.
 */
export const strengthSetTypeSchema = z
  .enum(['normal', 'warmup', 'drop_set', 'failure'])
  .meta({ description: 'Set kind; `normal` is a working set', id: 'StrengthSetType' })

export type StrengthSetType = z.infer<typeof strengthSetTypeSchema>

export const entryChannelSchema = z
  .enum(['hermes', 'web', 'api', 'mcp'])
  .meta({ description: 'Where a manual strength entry came from', id: 'EntryChannel' })

export type EntryChannel = z.infer<typeof entryChannelSchema>

/**
 * One set in `activities.data.sets`: the Gravl set shape (exercise repeated per
 * set, `weight` kg, `time` s, `distance` m) plus a stable `set_id`, the
 * canonical `exercise_key` and per-set provenance so manual sets can be edited
 * individually.
 */
export const strengthSetSchema = z
  .object({
    bodyweight: z.boolean().optional().meta({ description: 'Bodyweight movement; `weight` is added load' }),
    distance: z.number().nonnegative().nullable().meta({ description: 'Metres' }),
    exercise: z.string().meta({ description: 'Canonical exercise display name', example: 'Bench Press' }),
    exercise_id: z.union([z.number(), z.string()]).optional(),
    exercise_key: z
      .string()
      .optional()
      .meta({ description: 'Stable exercise identifier', example: 'bench_press' }),
    exercise_order: z.number().int().positive().optional(),
    logged_at: iso8601DateTimeSchema.optional(),
    logged_via: entryChannelSchema.optional(),
    notes: z.string().nullable().optional(),
    order: z.number().int().nonnegative().meta({ description: 'Set order within its exercise' }),
    reps: z.number().int().nonnegative().nullable(),
    rpe: z.number().min(0).max(10).nullable(),
    set_id: z.string().optional(),
    set_type: strengthSetTypeSchema,
    superset_id: z.number().optional(),
    time: z.number().nonnegative().nullable().meta({ description: 'Seconds, for timed sets' }),
    weight: z.number().nonnegative().nullable().meta({ description: 'Kilograms of external load' }),
  })
  .meta({ id: 'StrengthSet' })

export type StrengthSet = z.infer<typeof strengthSetSchema>

export const weightUnitSchema = z.enum(['kg', 'lb']).meta({ id: 'WeightUnit' })

export const strengthSetInputSchema = z
  .object({
    bodyweight: z.boolean().optional(),
    distance: z.number().nonnegative().optional().meta({ description: 'Metres' }),
    notes: z.string().max(500).optional(),
    reps: z.number().int().nonnegative().optional(),
    rpe: z.number().min(0).max(10).optional(),
    set_type: strengthSetTypeSchema.optional(),
    time: z.number().nonnegative().optional().meta({ description: 'Seconds' }),
    weight: z
      .number()
      .nonnegative()
      .optional()
      .meta({ description: 'External load in `weight_unit` (default kg)' }),
    weight_unit: weightUnitSchema.optional(),
  })
  .meta({ id: 'StrengthSetInput' })

export type StrengthSetInput = z.infer<typeof strengthSetInputSchema>

export const strengthExerciseInputSchema = z
  .object({
    exercise: z.string().min(1).max(120).meta({ description: 'Exercise name or alias', example: 'bench' }),
    sets: z.array(strengthSetInputSchema).min(1).max(100),
  })
  .meta({ id: 'StrengthExerciseInput' })

export type StrengthExerciseInput = z.infer<typeof strengthExerciseInputSchema>

export const workoutGroupingSchema = z.enum(['auto', 'new', 'append_latest']).meta({
  description:
    '`auto` appends to the latest manual strength workout of the same local day when it was last touched within the session gap (default 3 h) and creates one otherwise; `new` always creates one; `append_latest` appends to the latest manual strength workout of that day.',
  id: 'WorkoutGrouping',
})

export type WorkoutGrouping = z.infer<typeof workoutGroupingSchema>

export const logStrengthBodySchema = z
  .object({
    date: z.iso
      .date()
      .optional()
      .meta({ description: 'Local date the sets were done, when no time is known (e.g. "yesterday")' }),
    dry_run: z.boolean().optional().meta({ description: 'Parse and resolve only; write nothing' }),
    end_time: iso8601DateTimeSchema.optional(),
    entry_channel: entryChannelSchema.optional(),
    exercises: z.array(strengthExerciseInputSchema).max(50).optional(),
    grouping: workoutGroupingSchema.optional(),
    idempotency_key: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .meta({ description: 'Replaying the same key returns the first result instead of writing again' }),
    message_time: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'When the user sent the message; used as the workout time when none is given' }),
    notes: z.string().max(2000).optional(),
    performed_at: iso8601DateTimeSchema
      .optional()
      .meta({ description: 'Explicit start time of the session' }),
    text: z.string().max(2000).optional().meta({
      description: 'Free text such as "bench 5x5 50kg, squat 3x8 70kg"; parsed when `exercises` is absent',
    }),
    title: z.string().max(255).optional(),
    tz: z.string().optional().meta({ description: 'IANA time zone for dates and the reply text' }),
    workout_id: z.uuid().optional().meta({ description: 'Append to this workout' }),
  })
  .refine((b) => (b.exercises?.length ?? 0) > 0 || (b.text?.trim().length ?? 0) > 0, {
    message: 'Provide exercises or text',
  })
  .meta({ id: 'LogStrengthBody' })

export type LogStrengthBody = z.infer<typeof logStrengthBodySchema>

export const updateStrengthSetBodySchema = z
  .object({
    bodyweight: z.boolean().optional(),
    distance: z.number().nonnegative().nullable().optional(),
    exercise: z.string().min(1).max(120).optional(),
    notes: z.string().max(500).nullable().optional(),
    reps: z.number().int().nonnegative().nullable().optional(),
    rpe: z.number().min(0).max(10).nullable().optional(),
    set_type: strengthSetTypeSchema.optional(),
    time: z.number().nonnegative().nullable().optional(),
    weight: z.number().nonnegative().nullable().optional(),
    weight_unit: weightUnitSchema.optional(),
  })
  .meta({ id: 'UpdateStrengthSetBody' })

export type UpdateStrengthSetBody = z.infer<typeof updateStrengthSetBodySchema>

export const workoutSourceSchema = z.object({
  activity_id: z.string(),
  end_time: iso8601DateTimeSchema.optional(),
  external_id: z.string().optional(),
  role: z.enum(['primary', 'linked', 'merged']),
  source: z.string(),
  start_time: iso8601DateTimeSchema,
  title: z.string().optional(),
})

export const hrCoverageStatusSchema = z
  .enum(['ok', 'sparse', 'unavailable'])
  .meta({ description: 'How well heart-rate samples cover the session', id: 'HrCoverageStatus' })

export const workoutHeartRateSchema = z
  .object({
    avg: z.number().optional(),
    coverage: z
      .number()
      .min(0)
      .max(1)
      .meta({ description: 'Share of session minutes with at least one sample' }),
    max: z.number().optional(),
    overlapping_activity_ids: z.array(z.string()).meta({
      description:
        'Other workouts overlapping this one; their samples are shared, not attributable to one session',
    }),
    sample_count: z.number().int(),
    status: hrCoverageStatusSchema,
    zone_secs: hrZoneSecsSchema.optional(),
    zone_source: hrZoneSourceSchema.optional(),
  })
  .meta({ id: 'WorkoutHeartRate' })

export type WorkoutHeartRate = z.infer<typeof workoutHeartRateSchema>

export const exerciseSummarySchema = z.object({
  best_e1rm: z.number().optional(),
  exercise: z.string(),
  exercise_key: z.string(),
  reps_total: z.number().int(),
  set_count: z.number().int(),
  top_set: z.object({ reps: z.number().nullable(), weight: z.number().nullable() }).optional(),
  volume_kg: z.number(),
})

export type ExerciseSummary = z.infer<typeof exerciseSummarySchema>

export const workoutSummarySchema = z
  .object({
    activity_type: activityTypeSchema,
    calories: z.number().optional(),
    color: z.string(),
    display_name: z.string(),
    distance: z.number().optional().meta({ description: 'Metres' }),
    duration_min: z.number().optional(),
    end_time: iso8601DateTimeSchema.optional(),
    exercise_count: z.number().int(),
    hr_avg: z.number().optional(),
    hr_coverage: z.number().optional(),
    hr_max: z.number().optional(),
    icon: z
      .string()
      .optional()
      .meta({ description: "The workout type's icon: an emoji or an uploaded icon path" }),
    id: z.string().meta({ description: 'Activity id of the row that represents the merged workout' }),
    intensity: z
      .enum(['easy', 'moderate', 'hard'])
      .optional()
      .meta({ description: "The source's own intensity label (Oura), when it gives one" }),
    member_ids: z.array(z.string()),
    notes: z.string().optional(),
    set_count: z.number().int(),
    sets_status: z
      .enum(['logged', 'not_logged', 'not_applicable'])
      .meta({ description: '`not_logged`: a strength session with no sets recorded (not zero sets done)' }),
    sources: z.array(z.string()),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional(),
    volume_kg: z.number(),
    zone_secs: hrZoneSecsSchema.optional(),
  })
  .meta({ id: 'WorkoutSummary' })

export type WorkoutSummary = z.infer<typeof workoutSummarySchema>

export const workoutLinkSchema = z
  .object({
    confidence: z.number(),
    created_at: iso8601DateTimeSchema,
    linked_id: z.string(),
    method: z.enum(['auto', 'user']),
    primary_id: z.string(),
    reasons: z.array(z.string()),
    status: z.enum(['confirmed', 'suggested', 'rejected']),
  })
  .meta({ id: 'WorkoutLink' })

export type WorkoutLink = z.infer<typeof workoutLinkSchema>

export const workoutLinkSuggestionSchema = z
  .object({
    activity_id: z.string(),
    activity_type: z.string(),
    confidence: z.number(),
    end_time: iso8601DateTimeSchema.optional(),
    reasons: z.array(z.string()),
    source: z.string(),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional(),
  })
  .meta({ id: 'WorkoutLinkSuggestion' })

export type WorkoutLinkSuggestion = z.infer<typeof workoutLinkSuggestionSchema>

export const workoutDetailSchema = workoutSummarySchema
  .extend({
    exercises: z.array(exerciseSummarySchema),
    heart_rate: workoutHeartRateSchema,
    links: z.array(workoutLinkSchema),
    provenance: z
      .record(z.string(), z.string())
      .meta({ description: 'Field name → source that supplied it (e.g. calories → oura, sets → hermes)' }),
    sets: z.array(strengthSetSchema),
    sources_detail: z.array(workoutSourceSchema),
    suggestions: z.array(workoutLinkSuggestionSchema),
    time_source: z
      .string()
      .optional()
      .meta({ description: '`explicit`, `message_time`, `date_only` or a sync source' }),
  })
  .meta({ id: 'WorkoutDetail' })

export type WorkoutDetail = z.infer<typeof workoutDetailSchema>

export const workoutsQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional(),
    start: iso8601DateTimeSchema.optional(),
    tz: z.string().optional(),
    types: z
      .string()
      .optional()
      .meta({ description: 'Comma-separated activity types; parents include their subtypes' }),
  })
  .meta({ id: 'WorkoutsQuery' })

export type WorkoutsQuery = z.infer<typeof workoutsQuerySchema>

export const workoutsResponseSchema = createDataArrayResponseSchema(workoutSummarySchema).meta({
  id: 'WorkoutsResponse',
})
export type WorkoutsResponse = z.infer<typeof workoutsResponseSchema>

export const workoutDetailResponseSchema = createDataResponseSchema(workoutDetailSchema).meta({
  id: 'WorkoutDetailResponse',
})
export type WorkoutDetailResponse = z.infer<typeof workoutDetailResponseSchema>

export const parsedStrengthExerciseSchema = z.object({
  exercise: z.string(),
  exercise_key: z.string(),
  input: z.string(),
  known: z.boolean().meta({ description: 'Resolved against the exercise catalog' }),
  sets: z.array(strengthSetInputSchema),
})

export const parsedStrengthTextSchema = z
  .object({
    date: z.string().optional(),
    exercises: z.array(parsedStrengthExerciseSchema),
    time: z.string().optional().meta({ description: 'HH:MM when the text named a time' }),
    unparsed: z.array(z.string()).meta({ description: 'Fragments that could not be read as sets' }),
  })
  .meta({ id: 'ParsedStrengthText' })

export type ParsedStrengthText = z.infer<typeof parsedStrengthTextSchema>

export const logStrengthResultSchema = z
  .object({
    added_set_ids: z.array(z.string()),
    created: z.boolean(),
    dry_run: z.boolean(),
    link: workoutLinkSchema.optional(),
    parsed: parsedStrengthTextSchema.optional(),
    replayed: z.boolean().meta({ description: 'An idempotency key matched an earlier request' }),
    summary_text: z.string().meta({ description: 'Ready-to-send confirmation' }),
    workout: workoutDetailSchema.optional(),
  })
  .meta({ id: 'LogStrengthResult' })

export type LogStrengthResult = z.infer<typeof logStrengthResultSchema>

export const logStrengthResponseSchema = createDataResponseSchema(logStrengthResultSchema).meta({
  id: 'LogStrengthResponse',
})
export type LogStrengthResponse = z.infer<typeof logStrengthResponseSchema>

export const linkWorkoutBodySchema = z
  .object({ linked_id: z.uuid() })
  .meta({ id: 'LinkWorkoutBody', description: 'Confirm that two activities are one workout' })
export type LinkWorkoutBody = z.infer<typeof linkWorkoutBodySchema>

export const workoutLinksResponseSchema = createDataArrayResponseSchema(workoutLinkSchema).meta({
  id: 'WorkoutLinksResponse',
})
export type WorkoutLinksResponse = z.infer<typeof workoutLinksResponseSchema>

export const exerciseDefinitionSchema = z
  .object({
    aliases: z.array(z.string()),
    builtin: z.boolean(),
    category: z.string().optional(),
    equipment: z.string().optional(),
    is_bodyweight: z.boolean(),
    key: z.string(),
    last_logged: iso8601DateTimeSchema.optional(),
    logged_sets: z.number().int(),
    muscle_group: z.string().optional(),
    name: z.string(),
  })
  .meta({ id: 'ExerciseDefinition' })

export type ExerciseDefinition = z.infer<typeof exerciseDefinitionSchema>

export const exercisesResponseSchema = createDataArrayResponseSchema(exerciseDefinitionSchema).meta({
  id: 'ExercisesResponse',
})
export type ExercisesResponse = z.infer<typeof exercisesResponseSchema>

export const addExerciseBodySchema = z
  .object({
    aliases: z.array(z.string().min(1).max(120)).max(30).optional(),
    category: z.string().max(60).optional(),
    equipment: z.string().max(60).optional(),
    is_bodyweight: z.boolean().optional(),
    muscle_group: z.string().max(60).optional(),
    name: z.string().min(1).max(120),
  })
  .meta({ id: 'AddExerciseBody' })
export type AddExerciseBody = z.infer<typeof addExerciseBodySchema>

export const exerciseResponseSchema = createDataResponseSchema(exerciseDefinitionSchema).meta({
  id: 'ExerciseResponse',
})
export type ExerciseResponse = z.infer<typeof exerciseResponseSchema>

export const strengthProgressQuerySchema = z
  .object({
    end: iso8601DateTimeSchema.optional(),
    exercise: z.string().min(1).meta({ description: 'Exercise key, name or alias' }),
    start: iso8601DateTimeSchema.optional(),
    tz: z.string().optional(),
  })
  .meta({ id: 'StrengthProgressQuery' })
export type StrengthProgressQuery = z.infer<typeof strengthProgressQuerySchema>

const setRefSchema = z.object({
  date: z.string().meta({ description: 'Local date YYYY-MM-DD' }),
  reps: z.number().nullable(),
  weight: z.number().nullable(),
  workout_id: z.string(),
})

export const strengthSessionPointSchema = z.object({
  best_e1rm: z.number().optional(),
  date: z.string(),
  reps_total: z.number().int(),
  set_count: z.number().int(),
  start_time: iso8601DateTimeSchema,
  top_set: z.object({ reps: z.number().nullable(), weight: z.number().nullable() }).optional(),
  volume_kg: z.number(),
  workout_id: z.string(),
})

export const strengthProgressSchema = z
  .object({
    e1rm: z.object({
      formula: z.literal('epley'),
      max_reps: z.number().int(),
      note: z.string(),
    }),
    exercise: z.object({ key: z.string(), name: z.string() }),
    prs: z.object({
      best_e1rm: setRefSchema.extend({ e1rm: z.number() }).optional(),
      best_volume_session: z
        .object({ date: z.string(), volume_kg: z.number(), workout_id: z.string() })
        .optional(),
      heaviest_set: setRefSchema.optional(),
    }),
    rep_bests: z.array(z.object({ best_reps: z.number().int(), date: z.string(), weight: z.number() })),
    sessions: z.array(strengthSessionPointSchema),
    sets: z.array(strengthSetSchema.extend({ date: z.string(), workout_id: z.string() })),
    weekly: z.array(
      z.object({
        best_e1rm: z.number().optional(),
        sessions: z.number().int(),
        volume_kg: z.number(),
        week_start: z.string(),
      }),
    ),
  })
  .meta({ id: 'StrengthProgress' })

export type StrengthProgress = z.infer<typeof strengthProgressSchema>

export const strengthProgressResponseSchema = createDataResponseSchema(strengthProgressSchema).meta({
  id: 'StrengthProgressResponse',
})
export type StrengthProgressResponse = z.infer<typeof strengthProgressResponseSchema>

export const strengthSetMutationResponseSchema = baseResponseSchema
  .extend({ data: workoutDetailSchema.optional(), summary_text: z.string().optional() })
  .meta({ id: 'StrengthSetMutationResponse' })
export type StrengthSetMutationResponse = z.infer<typeof strengthSetMutationResponseSchema>

export const parseStrengthBodySchema = z
  .object({ text: z.string().min(1).max(2000), tz: z.string().optional() })
  .meta({ id: 'ParseStrengthBody' })
export type ParseStrengthBody = z.infer<typeof parseStrengthBodySchema>

export const parseStrengthResponseSchema = createDataResponseSchema(parsedStrengthTextSchema).meta({
  id: 'ParseStrengthResponse',
})
export type ParseStrengthResponse = z.infer<typeof parseStrengthResponseSchema>
