import type { Request, Response } from 'express'

import axios from 'axios'
import { addDays, addSeconds, formatISO, isAfter, isBefore, isFuture, min, startOfDay } from 'date-fns'
import { createHash, randomBytes } from 'node:crypto'

import {
  deleteOAuthToken,
  getOAuthToken,
  initializeSchema,
  schemaInitialized,
  upsertOAuthToken,
} from '../../db/index.ts'
import { redactSecret } from '../garmin/client.ts'

/** Oura tag record used during sync processing (mapped to activities). */
export interface OuraTagWithComment {
  source: 'oura'
  external_id: string
  tag: string
  tag_key?: string
  start_time: Date
  end_time?: Date
  comment?: string
}

type OuraTag = {
  id: string
  tag_type_code: string | null
  start_time: string
  end_time: string
  custom_name: string | null
  comment: string | null
}

type OuraSession = {
  id: string
  end_datetime: string
  start_datetime: string
  type: string
  heart_rate: unknown
  heart_rate_variability: unknown
  mood: string
  motion_count: unknown
}

/** Raw Oura sleep period record from /v2/usercollection/sleep */
export type OuraSleepPeriodRaw = {
  id: string
  type: string // 'long_sleep' | 'sleep' | 'rest'
  bedtime_start: string
  bedtime_end: string
  sleep_phase_5_min: string | null
  heart_rate: { interval: number; items: (number | null)[] } | null
  heart_rate_variability: { interval: number; items: (number | null)[] } | null
  average_hrv: number | null
  lowest_heart_rate: number | null
  average_heart_rate: number | null
  readiness_score_delta: number | null
  day: string
}

export type OuraWorkoutRaw = {
  id: string
  activity: string
  calories: number | null
  day: string
  distance: number | null
  end_datetime: string
  intensity?: string
  label?: string | null
  source?: string
  start_datetime: string
}

export type OuraHeartRateRaw = {
  bpm: number
  source?: string
  timestamp: string
}

export interface OuraClientOptions {
  onUserAuthenticated?: (ouraUserId: string, username: string) => Promise<void>
  /** Override the OAuth callback independently from the public API base URL. */
  redirectUri?: string
  /** Space-delimited Oura OAuth scopes requested during authorization. */
  scopes?: string
}

export type OuraCredentialGetter = () => Promise<{ clientId: string; clientSecret: string }>

export const ouraClient = (
  getCredentials: OuraCredentialGetter,
  apiBaseUrl: string,
  options?: OuraClientOptions,
) => {
  const redirectUri = options?.redirectUri ?? `${apiBaseUrl}/auth/ouracb`
  const pendingAuthorizations = new Map<string, { codeVerifier: string; createdAt: number; user: string }>()

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const requestPage = async <T>(
    type: string,
    params: Record<string, string>,
    token: string,
  ): Promise<{ data?: T[]; next_token?: string | null }> => {
    const backoffMs = [1_000, 2_000, 5_000, 10_000]
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await axios.get(`https://api.ouraring.com/v2/usercollection/${type}`, {
          headers: { Authorization: `Bearer ${token}` },
          params,
        })
        return response.data
      } catch (error) {
        const response = (error as { response?: { status?: number; headers?: Record<string, string> } })
          .response
        const retryable = !response || response.status === 429 || (response.status ?? 0) >= 500
        if (!retryable || attempt >= backoffMs.length) throw error
        const retryAfterSeconds = Number(response?.headers?.['retry-after'])
        const delay = Number.isFinite(retryAfterSeconds)
          ? Math.min(retryAfterSeconds * 1_000, 60_000)
          : backoffMs[attempt]
        await sleep(delay)
      }
    }
  }

  /** Fetch every page from an Oura v2 collection endpoint. */
  const getCollection = async <T>(
    type: string,
    params: Record<string, string>,
    token: string,
  ): Promise<T[]> => {
    const records: T[] = []
    let nextToken: string | undefined
    do {
      const page = await requestPage<T>(
        type,
        nextToken ? { ...params, next_token: nextToken } : params,
        token,
      )
      records.push(...(page.data ?? []))
      nextToken = page.next_token ?? undefined
    } while (nextToken)
    return records
  }

  const getGeneric = async <T = Record<string, unknown>>(
    type: string,
    start: Date,
    end: Date,
    token: string,
  ): Promise<T[]> =>
    getCollection<T>(
      type,
      {
        end_date: formatISO(addDays(end, 1), { representation: 'date' }),
        start_date: formatISO(start, { representation: 'date' }),
      },
      token,
    )

  const getPersonalInfo = async (accessToken: string): Promise<{ id: string } | null> => {
    try {
      const response = await axios.get('https://api.ouraring.com/v2/usercollection/personal_info', {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      return response.data
    } catch (error) {
      console.error('Failed to fetch Oura personal info:', error instanceof Error ? error.message : error)
      return null
    }
  }

  return {
    async authCb(req: Request, res: Response) {
      const { code, scope, state, error } = req.query as Record<string, string | undefined>

      if (error) {
        res.statusCode = 500
        return res.end('{"success":false}')
      }

      let clientId: string
      let clientSecret: string
      try {
        ;({ clientId, clientSecret } = await getCredentials())
      } catch {
        res.statusCode = 500
        return res.end('{"success":false,"error":"Oura not configured"}')
      }

      const pending = state ? pendingAuthorizations.get(state) : undefined
      if (!pending || Date.now() - pending.createdAt > 15 * 60 * 1000) {
        if (state) pendingAuthorizations.delete(state)
        res.statusCode = 400
        return res.end('{"success":false,"error":"Invalid or expired OAuth state"}')
      }
      pendingAuthorizations.delete(state!)
      const user = pending.user

      if (!(await schemaInitialized(user))) {
        await initializeSchema(user)
      }

      const tokenParams = new URLSearchParams()
      tokenParams.append('grant_type', 'authorization_code')
      tokenParams.append('client_id', clientId)
      tokenParams.append('client_secret', clientSecret)
      tokenParams.append('code', code as string)
      tokenParams.append('redirect_uri', redirectUri)
      tokenParams.append('code_verifier', pending.codeVerifier)

      const response = await axios.post('https://api.ouraring.com/oauth/token', tokenParams, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })

      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        access_token,
        expires_at: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refresh_token,
        scopes: scope ? scope.split(' ') : undefined,
      })

      // Store Oura user ID mapping for webhook notifications
      if (options?.onUserAuthenticated) {
        const personalInfo = await getPersonalInfo(access_token)
        if (personalInfo?.id) {
          await options.onUserAuthenticated(personalInfo.id, user)
        }
      }

      res.end()
    },

    async disconnect(user: string): Promise<void> {
      const token = await getOAuthToken(user, 'oura')
      if (!token) return

      if (token.access_token) {
        // A lapsed subscription answers 403 here; the local grant must go regardless.
        try {
          await axios.post('https://api.ouraring.com/oauth/revoke', undefined, {
            params: { access_token: token.access_token },
          })
        } catch (error) {
          console.warn(
            `Oura token revoke failed for ${user}, deleting local grant anyway:`,
            redactSecret(error instanceof Error ? error.message : String(error), token.access_token),
          )
        }
      }

      await deleteOAuthToken(user, 'oura')
    },

    async getAccessToken(user: string) {
      const token = await getOAuthToken(user, 'oura')
      if (!token) throw new Error('User has no Oura OAuth token')

      // Return token if not expired (with 100 second buffer)
      if (token.expires_at && isFuture(addSeconds(token.expires_at, -100))) {
        return token.access_token
      }

      const { clientId, clientSecret } = await getCredentials()
      const tokenParams = new URLSearchParams()
      tokenParams.append('grant_type', 'refresh_token')
      tokenParams.append('refresh_token', token.refresh_token!)
      tokenParams.append('client_id', clientId)
      tokenParams.append('client_secret', clientSecret)

      const response = await axios.post('https://api.ouraring.com/oauth/token', tokenParams, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      const { access_token, refresh_token, expires_in } = response.data

      await upsertOAuthToken(user, {
        access_token,
        expires_at: addSeconds(new Date(), expires_in),
        provider: 'oura',
        refresh_token,
      })

      return access_token
    },

    async getDailyCardiovascularAge(start: Date, end: Date, token: string) {
      return (await getGeneric<{ timestamp: string }>('daily_cardiovascular_age', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailyActivity(start: Date, end: Date, token: string) {
      return getGeneric<Record<string, unknown>>('daily_activity', start, end, token)
    },

    async getDailyStress(start: Date, end: Date, token: string) {
      return getGeneric<Record<string, unknown>>('daily_stress', start, end, token)
    },

    async getDailySpo2(start: Date, end: Date, token: string) {
      return getGeneric<Record<string, unknown>>('daily_spo2', start, end, token)
    },

    async getWorkouts(start: Date, end: Date, token: string): Promise<OuraWorkoutRaw[]> {
      return getGeneric<OuraWorkoutRaw>('workout', start, end, token)
    },

    async getHeartRate(start: Date, end: Date, token: string): Promise<OuraHeartRateRaw[]> {
      // One-day datetime windows keep high-frequency retries bounded; getCollection
      // follows every next_token page within each window.
      const samples: OuraHeartRateRaw[] = []
      let windowStart = start
      while (isBefore(windowStart, end)) {
        const windowEnd = min([addDays(startOfDay(windowStart), 1), end])
        const records = await getCollection<OuraHeartRateRaw>(
          'heartrate',
          { end_datetime: windowEnd.toISOString(), start_datetime: windowStart.toISOString() },
          token,
        )
        samples.push(...records)
        windowStart = windowEnd
      }
      return samples
    },

    async getRingConfiguration(_start: Date, _end: Date, token: string) {
      return getCollection<Record<string, unknown>>('ring_configuration', {}, token)
    },

    async getDailyReadiness(start: Date, end: Date, token: string) {
      return (await getGeneric<{ timestamp: string }>('daily_readiness', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailyResilience(start: Date, end: Date, token: string) {
      return (await getGeneric<{ timestamp: string }>('daily_resilience', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getDailySleep(start: Date, end: Date, token: string) {
      return (await getGeneric<{ timestamp: string }>('daily_sleep', start, end, token)).filter(
        ({ timestamp }: { timestamp: string }) => isBefore(timestamp, end) && isAfter(timestamp, start),
      )
    },

    async getSessions(start: Date, end: Date, token: string) {
      // id: 'ab6b5798-2ecf-41cd-a0dc-7974796e49a4',
      // day: '2025-09-06',
      // start_datetime: '2025-09-06T15:49:27+02:00',
      // end_datetime: '2025-09-06T16:18:45+02:00',
      // type: 'meditation',
      // heart_rate: {    interval: 5,    items: [...
      // heart_rate_variability: {    interval: 5,    items: [
      // mood: 'good',
      // motion_count: {    interval: 5,    items: [
      const sessions = (await getGeneric<OuraSession>('session', start, end, token))
        .map((session) => ({
          endTime: new Date(session.end_datetime),
          heartRate: session.heart_rate,
          hrv: session.heart_rate_variability,
          id: session.id,
          mood: session.mood,
          motion: session.motion_count,
          startTime: new Date(session.start_datetime),
          type: session.type,
        }))
        .filter(({ startTime, endTime }) => isBefore(startTime, end) && isAfter(endTime, start))

      return sessions
    },

    async getSleep(start: Date, end: Date, token: string): Promise<OuraSleepPeriodRaw[]> {
      const data = await getGeneric<OuraSleepPeriodRaw>('sleep', start, end, token)
      return data.filter(
        ({ bedtime_start, bedtime_end }) => isBefore(bedtime_start, end) && isAfter(bedtime_end, start),
      )
    },
    async getTags(
      start: Date,
      end: Date,
      token: string,
      tagMappings?: Record<string, string>,
    ): Promise<OuraTagWithComment[]> {
      const data = await getGeneric<OuraTag>('enhanced_tag', start, end, token)
      const tags = data
        .map(
          (tag): OuraTagWithComment => ({
            comment: tag.comment ?? undefined,
            end_time: tag.end_time ? new Date(tag.end_time) : undefined,
            external_id: tag.id,
            source: 'oura',
            start_time: new Date(tag.start_time),
            tag:
              tag.tag_type_code && tagMappings && tag.tag_type_code in tagMappings
                ? tagMappings[tag.tag_type_code]
                : tag.custom_name || tag.tag_type_code || 'unknown',
            tag_key: tag.tag_type_code ?? undefined,
          }),
        )
        .filter(
          ({ start_time, end_time }) => isBefore(start_time, end) && (!end_time || isAfter(end_time, start)),
        )
      return tags
    },
    async getAuthorizeUrl(req: Request, res: Response) {
      const user = req.user
      if (!user) {
        res.status(401).json({ error: 'Not authenticated', success: false })
        return
      }

      let clientId: string
      try {
        ;({ clientId } = await getCredentials())
      } catch {
        res
          .status(400)
          .json({ error: 'Oura not configured — set credentials in Admin Settings', success: false })
        return
      }

      const location = new URL('https://cloud.ouraring.com/oauth/authorize')
      for (const [key, pending] of pendingAuthorizations) {
        if (Date.now() - pending.createdAt > 15 * 60 * 1000) pendingAuthorizations.delete(key)
      }
      const state = randomBytes(24).toString('base64url')
      const codeVerifier = randomBytes(48).toString('base64url')
      const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
      pendingAuthorizations.set(state, { codeVerifier, createdAt: Date.now(), user })
      location.searchParams.append('response_type', 'code')
      location.searchParams.append('client_id', clientId)
      location.searchParams.append('redirect_uri', redirectUri)
      if (options?.scopes) location.searchParams.append('scope', options.scopes)
      location.searchParams.append('state', state)
      location.searchParams.append('code_challenge', codeChallenge)
      location.searchParams.append('code_challenge_method', 'S256')
      res.json({ success: true, url: location.toString() })
    },
  }
}
