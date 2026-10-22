import type {
  ExerciseDefinition,
  ExercisesResponse,
  LogStrengthBody,
  LogStrengthResponse,
  LogStrengthResult,
  StrengthProgress,
  StrengthProgressResponse,
  UpdateStrengthSetBody,
  WorkoutDetail,
  WorkoutDetailResponse,
  WorkoutsResponse,
  WorkoutSummary,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { browserTz } from './client'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchWorkouts = async (start: Date, end: Date, types?: string[]): Promise<WorkoutSummary[]> => {
  const response = await axios.get<WorkoutsResponse>(`${API_URL}/workouts`, {
    headers: headers(),
    params: { end: end.toISOString(), start: start.toISOString(), types: types?.join(','), tz: browserTz },
  })
  return response.data.data ?? []
}

export const fetchWorkout = async (id: string): Promise<WorkoutDetail> => {
  const response = await axios.get<WorkoutDetailResponse>(`${API_URL}/workouts/${id}`, {
    headers: headers(),
    params: { tz: browserTz },
  })
  return response.data.data!
}

export const logStrengthSets = async (body: LogStrengthBody): Promise<LogStrengthResult> => {
  const response = await axios.post<LogStrengthResponse>(
    `${API_URL}/workouts/strength`,
    { entry_channel: 'web', tz: browserTz, ...body },
    { headers: headers() },
  )
  return response.data.data!
}

export const updateStrengthSet = async (
  workoutId: string,
  setId: string,
  body: UpdateStrengthSetBody,
): Promise<void> => {
  await axios.patch(`${API_URL}/workouts/${workoutId}/sets/${encodeURIComponent(setId)}`, body, {
    headers: headers(),
    params: { tz: browserTz },
  })
}

export const deleteStrengthSet = async (workoutId: string, setId: string): Promise<void> => {
  await axios.delete(`${API_URL}/workouts/${workoutId}/sets/${encodeURIComponent(setId)}`, {
    headers: headers(),
    params: { tz: browserTz },
  })
}

export const linkWorkout = async (id: string, linkedId: string): Promise<void> => {
  await axios.post(`${API_URL}/workouts/${id}/links`, { linked_id: linkedId }, { headers: headers() })
}

export const unlinkWorkout = async (id: string, linkedId: string): Promise<void> => {
  await axios.delete(`${API_URL}/workouts/${id}/links/${linkedId}`, { headers: headers() })
}

export const fetchExercises = async (): Promise<ExerciseDefinition[]> => {
  const response = await axios.get<ExercisesResponse>(`${API_URL}/workouts/exercises`, { headers: headers() })
  return response.data.data ?? []
}

export const fetchStrengthProgress = async (
  exercise: string,
  start?: Date,
  end?: Date,
): Promise<StrengthProgress> => {
  const response = await axios.get<StrengthProgressResponse>(`${API_URL}/workouts/strength/progress`, {
    headers: headers(),
    params: { end: end?.toISOString(), exercise, start: start?.toISOString(), tz: browserTz },
  })
  return response.data.data!
}

export const deleteWorkoutActivity = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/activities/${id}`, { headers: headers() })
}
