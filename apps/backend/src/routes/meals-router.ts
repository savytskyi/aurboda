import type { RequestHandler } from 'express'

import {
  type AddMealBody,
  addMealBodySchema,
  type DeleteMealResponse,
  type FrequentFoodItemsQuery,
  type FrequentFoodItemsResponse,
  type FrequentMealsQuery,
  type FrequentMealsResponse,
  frequentFoodItemsQuerySchema,
  frequentMealsQuerySchema,
  type MealPhotoResponse,
  type MealResponse,
  type MealsQuery,
  type MealsResponse,
  mealsQuerySchema,
  type NutrientPeriodSummaryQuery,
  type NutrientPeriodSummaryResponse,
  nutrientPeriodSummaryQuerySchema,
  type PutMealPhotoBody,
  putMealPhotoBodySchema,
  type UpdateMealBody,
  updateMealBodySchema,
} from '@aurboda/api-spec'

import { getMealLogCompleted, setMealLogCompleted, unsetMealLogCompleted } from '../db/index.ts'
import {
  addMeal,
  deleteMealById,
  deleteMealPhoto,
  getMeal,
  getMealPhoto,
  putMealPhoto,
  queryFrequentFoodItems,
  queryFrequentMeals,
  queryMeals,
  updateMealById,
} from '../services/meals.ts'
import { getMealPeriodSummary } from '../services/queries/meal-period-summary.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Check if a date is marked as logging-complete. Returns undefined if no date provided. */
const checkLogCompleted = async (user: string, start?: string): Promise<boolean | undefined> => {
  if (!start) return undefined
  const dateStr = start.slice(0, 10)
  const completed = await getMealLogCompleted(user, [dateStr])
  return completed.includes(dateStr)
}

export const createMealsRouter = (authMiddleware: AnyMiddleware): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, MealsResponse, unknown, MealsQuery>(
    '/',
    authMiddleware,
    validateQuery(mealsQuerySchema),
    async (req, res) => {
      const { meal_type, start, end, date } = req.query
      const user = req.user!
      const result = await queryMeals(user, { end, meal_type, start })
      // Use explicit `date` param (local date from frontend) for log_completed check,
      // not `start` which is UTC and may be a different calendar date due to timezone offset
      const log_completed = await checkLogCompleted(user, date)
      res.json({ data: result.data, log_completed, success: true })
    },
  )

  router.get<Record<string, never>, FrequentMealsResponse, unknown, FrequentMealsQuery>(
    '/frequent',
    authMiddleware,
    validateQuery(frequentMealsQuerySchema),
    async (req, res) => {
      const result = await queryFrequentMeals(req.user!, req.query)
      res.json({ data: result.data, success: true })
    },
  )

  router.get<Record<string, never>, FrequentFoodItemsResponse, unknown, FrequentFoodItemsQuery>(
    '/frequent-food-items',
    authMiddleware,
    validateQuery(frequentFoodItemsQuerySchema),
    async (req, res) => {
      const result = await queryFrequentFoodItems(req.user!, req.query)
      res.json({ data: result.data, success: true })
    },
  )

  router.get<Record<string, never>, NutrientPeriodSummaryResponse, unknown, NutrientPeriodSummaryQuery>(
    '/period-summary',
    authMiddleware,
    validateQuery(nutrientPeriodSummaryQuerySchema),
    async (req, res) => {
      const data = await getMealPeriodSummary(req.user!, {
        count_only_completed: req.query.count_only_completed,
        end: req.query.end,
        start: req.query.start,
        tz: req.query.tz,
      })
      res.json({ data, success: true })
    },
  )

  router.put<{ date: string }, DeleteMealResponse>(
    '/log-completed/:date',
    authMiddleware,
    async (req, res) => {
      await setMealLogCompleted(req.user!, req.params.date)
      res.json({ success: true })
    },
  )

  router.delete<{ date: string }, DeleteMealResponse>(
    '/log-completed/:date',
    authMiddleware,
    async (req, res) => {
      await unsetMealLogCompleted(req.user!, req.params.date)
      res.json({ success: true })
    },
  )

  router.get<{ id: string }, MealResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await getMeal(req.user!, req.params.id)
    if (!result.success) return res.status(404).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  })

  const handleUpsert: RequestHandler<Record<string, never>, MealResponse, AddMealBody> = async (req, res) => {
    const user = req.user!
    const result = await addMeal(user, { ...req.body })
    if (!result.success) return res.status(400).json({ error: result.error, success: false })
    res.json({ data: result.data, success: true })
  }

  router.put<Record<string, never>, MealResponse, AddMealBody>(
    '/',
    authMiddleware,
    validateBody(addMealBodySchema),
    handleUpsert,
  )
  router.post<Record<string, never>, MealResponse, AddMealBody>(
    '/',
    authMiddleware,
    validateBody(addMealBodySchema),
    handleUpsert,
  )

  router.patch<{ id: string }, MealResponse, UpdateMealBody>(
    '/:id',
    authMiddleware,
    validateBody(updateMealBodySchema),
    async (req, res) => {
      const result = await updateMealById(req.user!, req.params.id, req.body)
      if (!result.success) {
        // updateMealById can fail two ways now: the meal id doesn't resolve
        // (404) or a portion id in the body is invalid (400). Pick by the
        // errorCode the service set; unknown codes are treated as 500.
        const status = result.errorCode === 'invalid' ? 400 : result.errorCode === 'not_found' ? 404 : 500
        return res.status(status).json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.put<{ id: string; photoId: string }, MealPhotoResponse, PutMealPhotoBody>(
    '/:id/photos/:photoId',
    authMiddleware,
    validateBody(putMealPhotoBodySchema),
    async (req, res) => {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
        return res.status(400).json({ error: 'Meal and photo ids must be UUIDs', success: false })
      }
      const result = await putMealPhoto(req.user!, req.params.id, req.params.photoId, req.body)
      if (!result.success) {
        return res
          .status(result.errorCode === 'not_found' ? 404 : 400)
          .json({ error: result.error, success: false })
      }
      res.json({ data: result.data, success: true })
    },
  )

  router.get<{ id: string; photoId: string }, Buffer>(
    '/:id/photos/:photoId',
    authMiddleware,
    async (req, res) => {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
        return res.status(404).end()
      }
      const photo = await getMealPhoto(req.user!, req.params.id, req.params.photoId)
      if (!photo) return res.status(404).end()
      res.setHeader('Content-Type', photo.content_type)
      res.setHeader('Cache-Control', 'private, max-age=86400')
      res.send(photo.data)
    },
  )

  router.delete<{ id: string; photoId: string }, DeleteMealResponse>(
    '/:id/photos/:photoId',
    authMiddleware,
    async (req, res) => {
      if (!UUID_RE.test(req.params.id) || !UUID_RE.test(req.params.photoId)) {
        return res.status(404).json({ error: 'Photo not found', success: false })
      }
      const deleted = await deleteMealPhoto(req.user!, req.params.id, req.params.photoId)
      if (!deleted) return res.status(404).json({ error: 'Photo not found', success: false })
      res.json({ success: true })
    },
  )

  router.delete<{ id: string }, DeleteMealResponse>('/:id', authMiddleware, async (req, res) => {
    const result = await deleteMealById(req.user!, req.params.id)
    if (!result.success) return res.status(404).json({ error: result.error, success: false })
    res.json({ success: true })
  })

  return router
}
