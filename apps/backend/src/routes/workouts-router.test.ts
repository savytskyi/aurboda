import express from 'express'
import supertest from 'supertest'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { createWorkoutsRouter } from './workouts-router.ts'

vi.mock('../services/workouts/service.ts', () => ({
  addExercise: vi.fn(),
  DEFAULT_TZ: 'Europe/Ljubljana',
  deleteStrengthSet: vi.fn(),
  formatWorkoutReply: vi.fn(() => 'reply'),
  getWorkoutDetail: vi.fn(),
  linkWorkouts: vi.fn(),
  listExercises: vi.fn(),
  listWorkouts: vi.fn(),
  loadExerciseIndex: vi.fn(),
  logStrength: vi.fn(),
  strengthProgress: vi.fn(),
  unlinkWorkouts: vi.fn(),
  updateStrengthSet: vi.fn(),
}))

const service = await import('../services/workouts/service.ts')

const WORKOUT_ID = '9d0124e7-d161-4855-a54f-fa8bdb45c4f2'

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
  app.use(createWorkoutsRouter(auth) as unknown as express.RequestHandler)
  return app
}

const okResult = {
  added_set_ids: ['s1'],
  created: true,
  dry_run: false,
  replayed: false,
  summary_text: '✅',
}

describe('workouts router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test.each([
    ['get', '/'],
    ['get', `/${WORKOUT_ID}`],
    ['post', '/strength'],
    ['patch', `/${WORKOUT_ID}/sets/s1`],
    ['delete', `/${WORKOUT_ID}/sets/s1`],
    ['post', `/${WORKOUT_ID}/links`],
    ['get', '/strength/progress?exercise=bench'],
  ] as const)('%s %s requires authentication', async (method, path) => {
    const res = await supertest(buildApp())[method](path).send({})
    expect(res.status).toBe(401)
    expect(service.logStrength).not.toHaveBeenCalled()
    expect(service.listWorkouts).not.toHaveBeenCalled()
  })

  test('writes go to the authenticated user and take the Idempotency-Key header', async () => {
    vi.mocked(service.logStrength).mockResolvedValue({ ok: true, result: okResult })
    const res = await supertest(buildApp('ky'))
      .post('/strength')
      .set('Idempotency-Key', 'telegram:1:42')
      .send({ entry_channel: 'hermes', text: 'bench 5x5 50kg' })
    expect(res.status).toBe(201)
    expect(service.logStrength).toHaveBeenCalledWith('ky', {
      entry_channel: 'hermes',
      idempotency_key: 'telegram:1:42',
      text: 'bench 5x5 50kg',
    })
  })

  test('a replayed write answers 200, not 201', async () => {
    vi.mocked(service.logStrength).mockResolvedValue({ ok: true, result: { ...okResult, replayed: true } })
    const res = await supertest(buildApp('ky')).post('/strength').send({ text: 'bench 5x5 50kg' })
    expect(res.status).toBe(200)
    expect(res.body.data.replayed).toBe(true)
  })

  test('rejects a body with neither text nor exercises', async () => {
    const res = await supertest(buildApp('ky')).post('/strength').send({ tz: 'Europe/Ljubljana' })
    expect(res.status).toBe(400)
    expect(service.logStrength).not.toHaveBeenCalled()
  })

  test('reports a message without readable sets as a 400 with the error', async () => {
    vi.mocked(service.logStrength).mockResolvedValue({
      error: 'No sets could be read from the message',
      ok: false,
    })
    const res = await supertest(buildApp('ky')).post('/strength').send({ text: 'felt great' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('No sets could be read from the message')
  })

  test('detail is 404 for another id and 400 for a malformed one', async () => {
    vi.mocked(service.getWorkoutDetail).mockResolvedValue(null)
    expect((await supertest(buildApp('ky')).get(`/${WORKOUT_ID}`)).status).toBe(404)
    expect(service.getWorkoutDetail).toHaveBeenCalledWith('ky', WORKOUT_ID, 'Europe/Ljubljana')
    expect((await supertest(buildApp('ky')).get('/not-a-uuid')).status).toBe(400)
  })

  test('set corrections pass through to the user and return the reply text', async () => {
    vi.mocked(service.updateStrengthSet).mockResolvedValue({ workout: { id: WORKOUT_ID } as never })
    const res = await supertest(buildApp('ky')).patch(`/${WORKOUT_ID}/sets/s1`).send({ weight: 55 })
    expect(res.status).toBe(200)
    expect(res.body.summary_text).toBe('reply')
    expect(service.updateStrengthSet).toHaveBeenCalledWith(
      'ky',
      WORKOUT_ID,
      's1',
      { weight: 55 },
      'Europe/Ljubljana',
    )
  })

  test('limits the list range', async () => {
    const res = await supertest(buildApp('ky'))
      .get('/')
      .query({ end: '2026-10-22T00:00:00Z', start: '2024-01-01T00:00:00Z' })
    expect(res.status).toBe(400)
  })
})
