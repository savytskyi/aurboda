import {
  addExerciseBodySchema,
  logStrengthBodySchema,
  parseStrengthBodySchema,
  strengthProgressQuerySchema,
  updateStrengthSetBodySchema,
  workoutsQuerySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import {
  addExercise,
  DEFAULT_TZ,
  deleteStrengthSet,
  formatWorkoutReply,
  getWorkoutDetail,
  linkWorkouts,
  listExercises,
  listWorkouts,
  loadExerciseIndex,
  logStrength,
  strengthProgress,
  unlinkWorkouts,
  updateStrengthSet,
} from '../services/workouts/service.ts'
import { parseStrengthText } from '../services/workouts/strength-parse.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

const DAY_MS = 86_400_000

export const registerWorkoutTools = (server: McpServer, user: string) => {
  server.tool(
    'log_strength_workout',
    'Log strength sets (exercise, sets, reps, weight) to a workout. Pass the user\'s message as `text` (e.g. "bench 5x5 50kg, squat 3x8 70kg") or structured `exercises`. Always pass `idempotency_key` (e.g. "telegram:<chat>:<message id>") so a retried message is not logged twice, `message_time` (when the message was sent) and `tz`. Grouping `auto` appends to the latest manual strength workout of that day when it was added to within 3 hours, otherwise starts a new one; pass `workout_id` to add to a specific workout (an Oura session id creates the manual sets and links them to it). Matching Oura/Garmin strength sessions are linked automatically when the match is unambiguous; otherwise they are returned as suggestions. Returns `summary_text` to send back as the confirmation. Use `dry_run` to preview a parse without saving.',
    { ...logStrengthBodySchema.shape },
    async (params) => {
      const outcome = await logStrength(user, { ...params, entry_channel: params.entry_channel ?? 'mcp' })
      if (!outcome.ok) return errorResponse(JSON.stringify({ error: outcome.error, parsed: outcome.parsed }))
      return jsonResponse(outcome.result)
    },
  )

  server.tool(
    'parse_strength_text',
    'Read a strength log message into exercises and sets without saving anything. Unknown exercise names are flagged `known: false`; fragments that are not sets come back in `unparsed`.',
    { ...parseStrengthBodySchema.shape },
    async ({ text, tz }) => {
      const { index } = await loadExerciseIndex(user)
      return jsonResponse(parseStrengthText(text, { index, now: new Date(), tz: tz ?? DEFAULT_TZ }))
    },
  )

  server.tool(
    'list_workouts',
    'List workouts of every type (Oura, Garmin, manual/Hermes strength, …) merged into one entry per session, with duration, calories, HR, set count and volume. Defaults to the last 30 days. `types` is a comma-separated activity type filter (e.g. "strength_training,wrestling").',
    { ...workoutsQuerySchema.shape },
    async ({ start, end, types }) => {
      const endDate = end ? new Date(end) : new Date()
      const startDate = start ? new Date(start) : new Date(endDate.getTime() - 30 * DAY_MS)
      const list = await listWorkouts(user, {
        end: endDate,
        start: startDate,
        types: types
          ?.split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      })
      return jsonResponse(list)
    },
  )

  server.tool(
    'get_workout',
    'One workout in full: every set (with set_id for corrections), exercise totals, sources and per-field provenance, heart-rate coverage and zones, links and suggested links.',
    { id: z.uuid(), tz: z.string().optional() },
    async ({ id, tz }) => {
      const detail = await getWorkoutDetail(user, id, tz ?? DEFAULT_TZ)
      return detail ? jsonResponse(detail) : errorResponse('Workout not found')
    },
  )

  server.tool(
    'update_strength_set',
    'Correct one logged set (weight in kg unless weight_unit is "lb", reps, RPE, set type, exercise). Find the set_id with get_workout or strength_progress. Only manually logged sets can be edited.',
    {
      set_id: z.string(),
      tz: z.string().optional(),
      workout_id: z.uuid(),
      ...updateStrengthSetBodySchema.shape,
    },
    async ({ workout_id, set_id, tz, ...patch }) => {
      const result = await updateStrengthSet(user, workout_id, set_id, patch, tz ?? DEFAULT_TZ)
      if ('error' in result) return errorResponse(result.error)
      return jsonResponse({
        summary_text: formatWorkoutReply(result.workout, {
          created: false,
          now: new Date(),
          tz: tz ?? DEFAULT_TZ,
        }),
        workout: result.workout,
      })
    },
  )

  server.tool(
    'delete_strength_set',
    'Delete one manually logged set. Confirm with the user first when the set is not the one they just logged.',
    { set_id: z.string(), tz: z.string().optional(), workout_id: z.uuid() },
    async ({ workout_id, set_id, tz }) => {
      const result = await deleteStrengthSet(user, workout_id, set_id, tz ?? DEFAULT_TZ)
      if ('error' in result) return errorResponse(result.error)
      return jsonResponse({
        summary_text: formatWorkoutReply(result.workout, {
          created: false,
          now: new Date(),
          tz: tz ?? DEFAULT_TZ,
        }),
        workout: result.workout,
      })
    },
  )

  server.tool(
    'strength_progress',
    'Progression of one exercise (key, name or alias such as "bench"): per-session top set, Epley estimated 1RM (working sets of 1–12 reps; an estimate, not a tested max), volume, weekly totals, PRs (heaviest set, best e1RM, best volume session — separate records) and the raw sets with set_id and workout_id, oldest first. Use it for "show my last bench workout" (last session) and "how has my bench improved".',
    { ...strengthProgressQuerySchema.shape },
    async ({ exercise, start, end, tz }) =>
      jsonResponse(
        await strengthProgress(user, exercise, {
          end: end ? new Date(end) : undefined,
          start: start ? new Date(start) : undefined,
          tz: tz ?? DEFAULT_TZ,
        }),
      ),
  )

  server.tool(
    'list_exercises',
    'The exercise catalog: built-in and custom exercises with aliases and how many sets of each are logged.',
    {},
    async () => jsonResponse(await listExercises(user)),
  )

  server.tool(
    'add_exercise',
    'Add a custom exercise (or aliases for one) so later logs resolve to it.',
    { ...addExerciseBodySchema.shape },
    async (params) => jsonResponse(await addExercise(user, params)),
  )

  server.tool(
    'link_workouts',
    'Confirm that two activities are the same workout (e.g. manual sets and an Oura strength session). Reversible with unlink_workouts.',
    { id: z.uuid(), linked_id: z.uuid() },
    async ({ id, linked_id }) => {
      const result = await linkWorkouts(user, id, linked_id, { method: 'user' })
      return 'error' in result ? errorResponse(result.error) : jsonResponse(result)
    },
  )

  server.tool(
    'unlink_workouts',
    'Separate two activities that were merged as one workout; they are not merged automatically again.',
    { id: z.uuid(), linked_id: z.uuid() },
    async ({ id, linked_id }) => {
      const result = await unlinkWorkouts(user, id, linked_id)
      return 'error' in result ? errorResponse(result.error) : jsonResponse(result)
    },
  )
}
