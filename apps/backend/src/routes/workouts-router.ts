import type { RequestHandler } from 'express'

import {
  type AddExerciseBody,
  addExerciseBodySchema,
  type ExerciseResponse,
  type ExercisesResponse,
  type LinkWorkoutBody,
  linkWorkoutBodySchema,
  type LogStrengthBody,
  logStrengthBodySchema,
  type LogStrengthResponse,
  type ParseStrengthBody,
  parseStrengthBodySchema,
  type ParseStrengthResponse,
  type StrengthProgressQuery,
  strengthProgressQuerySchema,
  type StrengthProgressResponse,
  type StrengthSetMutationResponse,
  type UpdateStrengthSetBody,
  updateStrengthSetBodySchema,
  type WorkoutDetailResponse,
  type WorkoutLinksResponse,
  type WorkoutsQuery,
  workoutsQuerySchema,
  type WorkoutsResponse,
} from '@aurboda/api-spec'

import { getWorkoutLinksFor } from '../db/index.ts'
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
import { type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const tzOf = (raw: unknown): string => (typeof raw === 'string' && raw.length > 0 ? raw : DEFAULT_TZ)

export const createWorkoutsRouter = (authMiddleware: RequestHandler): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, WorkoutsResponse, unknown, WorkoutsQuery>(
    '/',
    authMiddleware,
    validateQuery(workoutsQuerySchema),
    async (req, res) => {
      const end = req.query.end ? new Date(req.query.end) : new Date()
      const start = req.query.start ? new Date(req.query.start) : new Date(end.getTime() - 30 * DAY_MS)
      if (end.getTime() - start.getTime() > 400 * DAY_MS) {
        res.status(400).json({ error: 'Range is limited to 400 days', success: false })
        return
      }
      const types = req.query.types
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      res.json({ data: await listWorkouts(req.user!, { end, start, types }), success: true })
    },
  )

  router.get<Record<string, never>, ExercisesResponse>('/exercises', authMiddleware, async (req, res) => {
    res.json({ data: await listExercises(req.user!), success: true })
  })

  router.post<Record<string, never>, ExerciseResponse, AddExerciseBody>(
    '/exercises',
    authMiddleware,
    validateBody(addExerciseBodySchema),
    async (req, res) => {
      res.json({ data: await addExercise(req.user!, req.body), success: true })
    },
  )

  router.post<Record<string, never>, LogStrengthResponse, LogStrengthBody>(
    '/strength',
    authMiddleware,
    validateBody(logStrengthBodySchema),
    async (req, res) => {
      const header = req.get('Idempotency-Key')
      const body = header && !req.body.idempotency_key ? { ...req.body, idempotency_key: header } : req.body
      const outcome = await logStrength(req.user!, body)
      if (!outcome.ok) {
        res
          .status(outcome.error.includes('still being processed') ? 409 : 400)
          .json({ error: outcome.error, success: false })
        return
      }
      res
        .status(outcome.result.created && !outcome.result.replayed ? 201 : 200)
        .json({ data: outcome.result, success: true })
    },
  )

  router.post<Record<string, never>, ParseStrengthResponse, ParseStrengthBody>(
    '/strength/parse',
    authMiddleware,
    validateBody(parseStrengthBodySchema),
    async (req, res) => {
      const { index } = await loadExerciseIndex(req.user!)
      res.json({
        data: parseStrengthText(req.body.text, { index, now: new Date(), tz: tzOf(req.body.tz) }),
        success: true,
      })
    },
  )

  router.get<Record<string, never>, StrengthProgressResponse, unknown, StrengthProgressQuery>(
    '/strength/progress',
    authMiddleware,
    validateQuery(strengthProgressQuerySchema),
    async (req, res) => {
      const data = await strengthProgress(req.user!, req.query.exercise, {
        end: req.query.end ? new Date(req.query.end) : undefined,
        start: req.query.start ? new Date(req.query.start) : undefined,
        tz: tzOf(req.query.tz),
      })
      res.json({ data, success: true })
    },
  )

  router.get<{ id: string }, WorkoutDetailResponse>('/:id', authMiddleware, async (req, res) => {
    if (!UUID.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid workout id', success: false })
      return
    }
    const detail = await getWorkoutDetail(req.user!, req.params.id, tzOf(req.query.tz))
    if (!detail) {
      res.status(404).json({ error: 'Workout not found', success: false })
      return
    }
    res.json({ data: detail, success: true })
  })

  router.patch<{ id: string; setId: string }, StrengthSetMutationResponse, UpdateStrengthSetBody>(
    '/:id/sets/:setId',
    authMiddleware,
    validateBody(updateStrengthSetBodySchema),
    async (req, res) => {
      if (!UUID.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid workout id', success: false })
        return
      }
      const tz = tzOf(req.query.tz)
      const result = await updateStrengthSet(req.user!, req.params.id, req.params.setId, req.body, tz)
      if ('error' in result) {
        res
          .status(result.error.endsWith('not found') ? 404 : 400)
          .json({ error: result.error, success: false })
        return
      }
      res.json({
        data: result.workout,
        success: true,
        summary_text: formatWorkoutReply(result.workout, { created: false, now: new Date(), tz }),
      })
    },
  )

  router.delete<{ id: string; setId: string }, StrengthSetMutationResponse>(
    '/:id/sets/:setId',
    authMiddleware,
    async (req, res) => {
      if (!UUID.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid workout id', success: false })
        return
      }
      const tz = tzOf(req.query.tz)
      const result = await deleteStrengthSet(req.user!, req.params.id, req.params.setId, tz)
      if ('error' in result) {
        res
          .status(result.error.endsWith('not found') ? 404 : 400)
          .json({ error: result.error, success: false })
        return
      }
      res.json({
        data: result.workout,
        success: true,
        summary_text: formatWorkoutReply(result.workout, { created: false, now: new Date(), tz }),
      })
    },
  )

  router.post<{ id: string }, WorkoutLinksResponse, LinkWorkoutBody>(
    '/:id/links',
    authMiddleware,
    validateBody(linkWorkoutBodySchema),
    async (req, res) => {
      if (!UUID.test(req.params.id)) {
        res.status(400).json({ error: 'Invalid workout id', success: false })
        return
      }
      const result = await linkWorkouts(req.user!, req.params.id, req.body.linked_id, { method: 'user' })
      if ('error' in result) {
        res
          .status(result.error === 'Activity not found' ? 404 : 400)
          .json({ error: result.error, success: false })
        return
      }
      res.json({ data: [result], success: true })
    },
  )

  router.delete<{ id: string; linkedId: string }, WorkoutLinksResponse>(
    '/:id/links/:linkedId',
    authMiddleware,
    async (req, res) => {
      if (!UUID.test(req.params.id) || !UUID.test(req.params.linkedId)) {
        res.status(400).json({ error: 'Invalid workout id', success: false })
        return
      }
      const result = await unlinkWorkouts(req.user!, req.params.id, req.params.linkedId)
      if ('error' in result) {
        res.status(404).json({ error: result.error, success: false })
        return
      }
      const links = await getWorkoutLinksFor(req.user!, [req.params.id])
      res.json({
        data: links.map((l) => ({ ...l, created_at: l.created_at.toISOString(), restore: undefined })),
        success: true,
      })
    },
  )

  return router
}
