import type {
  HealthDailyData,
  HealthDailyQuery,
  HealthDailyResponse,
  HealthOverviewData,
  HealthOverviewQuery,
  HealthOverviewResponse,
  SleepScheduleData,
  SleepScheduleQuery,
  SleepScheduleResponse,
  TagImpactData,
  TagImpactQuery,
  TagImpactResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { browserTz } from './client'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

const unwrap = <T>(body: { data?: T; error?: string; success: boolean }, what: string): T => {
  if (!body.success || body.data === undefined) throw new Error(body.error ?? `Failed to load ${what}`)
  return body.data
}

/** `date` defaults (server side) to today in the browser's zone. */
export const fetchHealthOverview = async (date?: string): Promise<HealthOverviewData> => {
  const params: HealthOverviewQuery = { date, tz: browserTz }
  const response = await axios.get<HealthOverviewResponse>(`${API_URL}/health/overview`, {
    headers: headers(),
    params,
  })
  return unwrap(response.data, 'health overview')
}

export const fetchHealthDaily = async (
  metrics: readonly string[],
  start: string,
  end: string,
  baselineDays?: number,
): Promise<HealthDailyData> => {
  const params: HealthDailyQuery = {
    baseline_days: baselineDays === undefined ? undefined : String(baselineDays),
    end,
    metrics: metrics.join(','),
    start,
    tz: browserTz,
  }
  const response = await axios.get<HealthDailyResponse>(`${API_URL}/health/daily`, {
    headers: headers(),
    params,
  })
  return unwrap(response.data, 'health history')
}

export const fetchSleepSchedule = async (start: string, end: string): Promise<SleepScheduleData> => {
  const params: SleepScheduleQuery = { end, start, tz: browserTz }
  const response = await axios.get<SleepScheduleResponse>(`${API_URL}/health/sleep-schedule`, {
    headers: headers(),
    params,
  })
  return unwrap(response.data, 'sleep schedule')
}

export const fetchTagImpact = async (days?: number): Promise<TagImpactData> => {
  const params: TagImpactQuery = { days: days === undefined ? undefined : String(days), tz: browserTz }
  const response = await axios.get<TagImpactResponse>(`${API_URL}/health/tag-impact`, {
    headers: headers(),
    params,
  })
  return unwrap(response.data, 'tag impact')
}
