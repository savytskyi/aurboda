import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { upsertFoodItem } from '../db/food-items.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  addMeal,
  deleteMealById,
  deleteMealPhoto,
  getMeal,
  getMealPhoto,
  putMealPhoto,
  queryMeals,
  updateMealById,
} from './meals.ts'

const CONTAINER_TIMEOUT = 120_000
const MEAL_ID = '6b0f9a5e-3c1d-4f5b-9d6e-1a2b3c4d5e6f'
const PHOTO_ID = '0d9c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a'
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])

const estimate = {
  components: [{ basis: 'visible', grams: 150, grams_high: 180, grams_low: 120, name: 'rice' }],
  confidence: 'medium',
  high: { calories: 234 },
  low: { calories: 156 },
  totals: { calories: 195 },
  unknown_nutrients: ['vitamin_d'],
}

describe('meal estimate and photos', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const logRice = async () => {
    const user = getTestUser()
    const rice = await upsertFoodItem(user, {
      calories: 130,
      default_quantity: 100,
      default_unit: 'g',
      name: 'Rice cooked',
    })
    return addMeal(user, {
      estimate,
      food_items: [{ food_item_id: rice.id, name: 'Rice cooked', quantity: 150, unit: 'g' }],
      id: MEAL_ID,
      source: 'hermes',
      time: '2026-10-24T11:30:00Z',
    })
  }

  test('stores the estimate unchanged and keeps it across idempotent re-puts and updates', async () => {
    const user = getTestUser()
    const first = await logRice()
    expect(first.data?.estimate).toEqual(estimate)
    expect(first.data?.calories).toBe(195)

    await logRice()
    const listed = await queryMeals(user, { end: '2026-10-25T00:00:00Z', start: '2026-10-24T00:00:00Z' })
    expect(listed.data).toHaveLength(1)

    const corrected = { ...estimate, corrections: [{ note: 'only half' }] }
    const updated = await updateMealById(user, MEAL_ID, { estimate: corrected })
    expect(updated.data?.estimate).toEqual(corrected)
    const cleared = await updateMealById(user, MEAL_ID, { name: 'Rice' })
    expect(cleared.data?.estimate).toEqual(corrected)
  })

  test('photos attach idempotently, list on the meal, stream back and cascade on delete', async () => {
    const user = getTestUser()
    await logRice()
    const body = {
      content_type: 'image/jpeg',
      data_base64: JPEG.toString('base64'),
      height: 1,
      kind: 'meal',
      width: 1,
    }

    const put = await putMealPhoto(user, MEAL_ID, PHOTO_ID, body)
    expect(put.success).toBe(true)
    expect((await putMealPhoto(user, MEAL_ID, PHOTO_ID, body)).success).toBe(true)

    const meal = await getMeal(user, MEAL_ID)
    expect(meal.data?.photos).toHaveLength(1)
    expect(meal.data?.photos?.[0]).toMatchObject({ content_type: 'image/jpeg', id: PHOTO_ID, kind: 'meal' })

    const bytes = await getMealPhoto(user, MEAL_ID, PHOTO_ID)
    expect(bytes?.data.equals(JPEG)).toBe(true)

    expect(await deleteMealPhoto(user, MEAL_ID, PHOTO_ID)).toBe(true)
    expect((await getMeal(user, MEAL_ID)).data?.photos).toBeUndefined()

    await putMealPhoto(user, MEAL_ID, PHOTO_ID, body)
    await deleteMealById(user, MEAL_ID)
    expect(await getMealPhoto(user, MEAL_ID, PHOTO_ID)).toBeNull()
  })

  test('rejects photos for unknown meals and data that is not the declared image type', async () => {
    const user = getTestUser()
    await logRice()
    const missing = await putMealPhoto(user, '11111111-2222-4333-8444-555555555555', PHOTO_ID, {
      content_type: 'image/jpeg',
      data_base64: JPEG.toString('base64'),
      kind: 'meal',
    })
    expect(missing).toMatchObject({ errorCode: 'not_found', success: false })
    const notJpeg = await putMealPhoto(user, MEAL_ID, PHOTO_ID, {
      content_type: 'image/jpeg',
      data_base64: Buffer.from('<svg/>').toString('base64'),
      kind: 'meal',
    })
    expect(notJpeg).toMatchObject({ errorCode: 'invalid', success: false })
  })
})
