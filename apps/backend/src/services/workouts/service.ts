/**
 * Workouts are activities: every exercise-category row from every source,
 * merged into one logical workout by the same pipeline the timeline uses.
 * Manually logged strength sets (Hermes, web, API) live on an `aurboda`
 * activity of type `strength_training` in the Gravl set shape; a confirmed
 * `workout_links` row joins it to the synced session (Oura, Garmin, …) it
 * belongs to, so the pair reads as one workout with the sets from one side
 * and heart rate and calories from the other, and a resync of either side
 * never touches the other's data.
 */

import type {
  ExerciseDefinition,
  LogStrengthBody,
  LogStrengthResult,
  ParsedStrengthText,
  StrengthProgress,
  StrengthSet,
  StrengthSetInput,
  UpdateStrengthSetBody,
  WorkoutDetail,
  WorkoutHeartRate,
  WorkoutLink,
  WorkoutLinkSuggestion,
  WorkoutSummary,
} from '@aurboda/api-spec'

import { Temporal } from '@js-temporal/polyfill'
import { createHash, randomUUID } from 'node:crypto'

import type { Activity, MergedActivity } from '../../db/types.ts'

import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type CustomExerciseRow,
  deleteSuggestedLinks,
  getActivitiesByIds,
  getActivitiesWithSets,
  getActivityNotes,
  getActivityTypeDefinitions,
  getExerciseActivitiesInRange,
  getExerciseUsage,
  getHrStatsForWindows,
  getHrZoneSecsForWindows,
  getIdempotencyRecord,
  getManualStrengthWorkouts,
  getStrengthCandidates,
  getWorkoutLink,
  getWorkoutLinksFor,
  insertActivity,
  listCustomExercises,
  materializeSuperseded,
  mergeOverlappingActivities,
  releaseIdempotencyKey,
  updateWorkoutRow,
  upsertCustomExercise,
  upsertWorkoutLink,
  type WorkoutLinkRow,
} from '../../db/index.ts'
import { replaceUserNotes } from '../../db/notes.ts'
import { getEffectiveHrZones } from '../settings.ts'
import {
  BUILTIN_EXERCISES,
  buildExerciseIndex,
  type ExerciseDef,
  type ExerciseIndex,
  exerciseKeyFromName,
  resolveExercise,
} from './exercise-catalog.ts'
import {
  AUTO_LINK_CONFIDENCE,
  CANDIDATE_WINDOW_MS,
  type CandidateSession,
  type ManualWorkout,
  rankCandidates,
  scoreMatch,
  STRENGTH_TYPES,
  SUGGEST_CONFIDENCE,
  type TimeSource,
} from './matching.ts'
import {
  buildProgress,
  formatVolume,
  formatWorkoutSets,
  sortSets,
  summarizeExercises,
  totalVolume,
} from './strength-math.ts'
import { localDateOf, parseStrengthText, shiftDate } from './strength-parse.ts'

export const DEFAULT_TZ = 'Europe/Ljubljana'
/** `auto` grouping appends to a manual workout last added to within this long. */
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000

const SOURCE_LABELS: Record<string, string> = {
  api: 'API',
  aurboda: 'Aurboda',
  garmin: 'Garmin',
  gravl: 'Gravl',
  health_connect: 'Health Connect',
  hermes: 'Hermes',
  manual: 'Manual',
  mcp: 'MCP',
  oura: 'Oura',
  strava: 'Strava',
  web: 'Web',
}

export const sourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source

const isManualStrength = (a: Activity): boolean => a.source === 'aurboda' && a.data?.manual_strength === true

/** `hermes` for a Hermes-logged workout, the sync source otherwise. */
const memberSource = (a: Activity): string =>
  isManualStrength(a) ? ((a.data?.entry_channel as string | undefined) ?? 'aurboda') : a.source

const setsOf = (a: Activity): StrengthSet[] =>
  Array.isArray(a.data?.sets) ? (a.data!.sets as StrengthSet[]) : []

const numberField = (data: Record<string, unknown> | undefined, key: string): number | undefined => {
  const v = data?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const round1 = (v: number): number => Math.round(v * 10) / 10

/** The factor the Gravl import converts with, so manual and Gravl sets agree. */
const LB_PER_KG = 2.20462262

const lbToKg = (lb: number): number => Math.round((lb / LB_PER_KG) * 1000) / 1000

// ---------------------------------------------------------------------------
// Exercise catalog

export const loadExerciseIndex = async (
  user: string,
): Promise<{ index: ExerciseIndex; custom: ExerciseDef[] }> => {
  const custom = (await listCustomExercises(user)).map((c) => ({ ...c, builtin: false }))
  return { custom, index: buildExerciseIndex(custom) }
}

export const listExercises = async (user: string): Promise<ExerciseDefinition[]> => {
  const { custom } = await loadExerciseIndex(user)
  const usage = await getExerciseUsage(user)
  const byKey = new Map<string, ExerciseDef>()
  for (const def of [...BUILTIN_EXERCISES, ...custom]) byKey.set(def.key, def)
  for (const key of usage.keys()) {
    if (!byKey.has(key)) {
      byKey.set(key, {
        aliases: [],
        builtin: false,
        is_bodyweight: false,
        key,
        name: key.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase()),
      })
    }
  }
  return [...byKey.values()]
    .map((def) => ({
      aliases: def.aliases,
      builtin: def.builtin,
      category: def.category,
      equipment: def.equipment,
      is_bodyweight: def.is_bodyweight,
      key: def.key,
      last_logged: usage.get(def.key)?.last.toISOString(),
      logged_sets: usage.get(def.key)?.sets ?? 0,
      muscle_group: def.muscle_group,
      name: def.name,
    }))
    .sort((a, b) => b.logged_sets - a.logged_sets || a.name.localeCompare(b.name))
}

export const addExercise = async (
  user: string,
  input: Omit<CustomExerciseRow, 'key' | 'aliases' | 'is_bodyweight'> & {
    aliases?: string[]
    is_bodyweight?: boolean
  },
): Promise<ExerciseDefinition> => {
  const row: CustomExerciseRow = {
    ...input,
    aliases: input.aliases ?? [],
    is_bodyweight: input.is_bodyweight ?? false,
    key: exerciseKeyFromName(input.name),
  }
  await upsertCustomExercise(user, row)
  return { ...row, builtin: false, logged_sets: 0 }
}

// ---------------------------------------------------------------------------
// Listing and detail

interface TypeInfo {
  display_name: string
  color: string
  category: string
}

const loadTypes = async (user: string): Promise<Map<string, TypeInfo>> =>
  new Map(
    (await getActivityTypeDefinitions(user)).map((d) => [
      d.name,
      { category: d.display_category, color: d.color, display_name: d.display_name },
    ]),
  )

interface Group {
  winner: MergedActivity
  members: Activity[]
}

const groupWorkouts = (raw: Activity[], types: Map<string, TypeInfo>): Group[] => {
  const categoryMap = new Map([...types.entries()].map(([name, t]) => [name, t.category]))
  const byId = new Map(raw.filter((a) => a.id).map((a) => [a.id!, a]))
  return mergeOverlappingActivities(raw, categoryMap).map((winner) => ({
    members: (winner.source_ids ?? [winner.id!]).map((id) => byId.get(id)).filter((a): a is Activity => !!a),
    winner,
  }))
}

const groupSets = (members: Activity[]): StrengthSet[] => {
  const seen = new Set<string>()
  const sets: StrengthSet[] = []
  for (const member of members
    .filter((m) => setsOf(m).length > 0)
    .sort((a, b) => Number(isManualStrength(b)) - Number(isManualStrength(a)))) {
    for (const set of setsOf(member)) {
      const id = set.set_id ?? `${member.id}:${set.exercise}:${set.order}`
      if (seen.has(id)) continue
      seen.add(id)
      sets.push(set)
    }
  }
  return sortSets(sets)
}

/** First member (manual entry first, then by merge rank) carrying the field. */
const fieldFrom = (members: Activity[], key: string): { value: number; source: string } | undefined => {
  for (const m of members) {
    const value = numberField(m.data, key)
    if (value !== undefined && value > 0) return { source: memberSource(m), value }
  }
  return undefined
}

const coverageStatus = (sampleCount: number, coverage: number): WorkoutHeartRate['status'] =>
  sampleCount === 0 ? 'unavailable' : coverage < 0.5 ? 'sparse' : 'ok'

const windowOf = (a: Activity): { start: Date; end: Date } => ({
  end: a.end_time ?? a.start_time,
  start: a.start_time,
})

const durationMin = (a: Activity): number | undefined =>
  a.end_time && a.end_time > a.start_time
    ? round1((a.end_time.getTime() - a.start_time.getTime()) / 60000)
    : undefined

interface Built {
  summary: WorkoutSummary
  group: Group
  hr: WorkoutHeartRate
  provenance: Record<string, string>
  sets: StrengthSet[]
}

const buildWorkouts = async (
  user: string,
  groups: Group[],
  types: Map<string, TypeInfo>,
): Promise<Built[]> => {
  const windows = groups.map((g) => windowOf(g.winner))
  const timedIdx = windows.map((w, i) => (w.end > w.start ? i : -1)).filter((i) => i >= 0)
  const hrStats = await getHrStatsForWindows(
    user,
    timedIdx.map((i) => windows[i]!),
  )
  const { zones, source: zoneSource } = await getEffectiveHrZones(user)
  const zoneSecs =
    zoneSource === 'default'
      ? []
      : await getHrZoneSecsForWindows(
          user,
          timedIdx.map((i) => windows[i]!),
          zones,
        )
  const notes = await getActivityNotes(
    user,
    groups.flatMap((g) => g.members.map((m) => m.id!)),
  )

  // eslint-disable-next-line complexity -- assembles every optional field of a workout summary
  return groups.map((group, i) => {
    const { winner, members } = group
    const ordered = [...members].sort((a, b) => Number(isManualStrength(b)) - Number(isManualStrength(a)))
    const type = types.get(winner.activity_type)
    const sets = groupSets(members)
    const statIdx = timedIdx.indexOf(i)
    const stats = statIdx >= 0 ? hrStats[statIdx] : undefined
    const minutes = durationMin(winner)
    const coverage =
      stats && minutes ? Math.min(1, stats.covered_minutes / Math.max(1, Math.round(minutes))) : 0
    const sampleCount = stats?.sample_count ?? 0
    const status = coverageStatus(sampleCount, coverage)
    const overlapping = groups
      .filter(
        (other, j) =>
          j !== i && other.winner.start_time < windows[i]!.end && windows[j]!.end > windows[i]!.start,
      )
      .map((other) => other.winner.id!)
    const hr: WorkoutHeartRate = {
      avg: status === 'unavailable' || stats?.avg === undefined ? undefined : Math.round(stats.avg),
      coverage: round1(coverage * 100) / 100,
      max: status === 'unavailable' ? undefined : stats?.max,
      overlapping_activity_ids: overlapping,
      sample_count: sampleCount,
      status,
      zone_secs: statIdx >= 0 && status !== 'unavailable' ? zoneSecs[statIdx] : undefined,
      zone_source: zoneSource,
    }

    const calories = fieldFrom(ordered, 'calories')
    const strengthLike = STRENGTH_TYPES.has(winner.activity_type)
    const distance = strengthLike ? undefined : fieldFrom(ordered, 'distance')
    const provenance: Record<string, string> = {}
    const timeMember = ordered.find((m) => m.id === winner.id) ?? ordered[0]
    provenance.time = timeMember ? memberSource(timeMember) : winner.source
    const linkedSync = members.find((m) => !isManualStrength(m))
    if (linkedSync && members.some(isManualStrength) && winner.data?.time_source === 'linked') {
      provenance.time = linkedSync.source
    }
    if (calories) provenance.calories = calories.source
    if (distance) provenance.distance = distance.source
    if (sets.length > 0) {
      const setMember = ordered.find((m) => setsOf(m).length > 0)!
      provenance.sets = memberSource(setMember)
    }
    if (sampleCount > 0) provenance.heart_rate = 'time_series'
    const noteText = members.flatMap((m) => notes.get(m.id!) ?? []).join('\n\n')

    const summary: WorkoutSummary = {
      activity_type: winner.activity_type,
      calories: calories ? Math.round(calories.value) : undefined,
      color: type?.color ?? '#6b7280',
      display_name: type?.display_name ?? winner.activity_type,
      distance: distance ? Math.round(distance.value) : undefined,
      duration_min: minutes,
      end_time: winner.end_time?.toISOString(),
      exercise_count: new Set(sets.map((s) => s.exercise_key ?? s.exercise)).size,
      hr_avg: hr.avg,
      hr_coverage: hr.coverage,
      hr_max: hr.max,
      id: winner.id!,
      member_ids: members.map((m) => m.id!),
      notes: noteText.length > 0 ? noteText : undefined,
      set_count: sets.length,
      sets_status: sets.length > 0 ? 'logged' : strengthLike ? 'not_logged' : 'not_applicable',
      sources: [...new Set(ordered.map(memberSource))],
      start_time: winner.start_time.toISOString(),
      title: winner.title ?? undefined,
      volume_kg: totalVolume(sets),
      zone_secs: hr.zone_secs,
    }
    return { group, hr, provenance, sets, summary }
  })
}

const loadGroups = async (user: string, start: Date, end: Date) => {
  const types = await loadTypes(user)
  const raw = await getExerciseActivitiesInRange(user, new Date(start.getTime() - 12 * 3600_000), end)
  const groups = groupWorkouts(raw, types).filter(
    (g) => types.get(g.winner.activity_type)?.category === 'exercise' && g.winner.start_time >= start,
  )
  return { groups, types }
}

export const listWorkouts = async (
  user: string,
  options: { start: Date; end: Date; types?: string[] },
): Promise<WorkoutSummary[]> => {
  const { groups, types } = await loadGroups(user, options.start, options.end)
  const built = await buildWorkouts(user, groups, types)
  const wanted = options.types?.length ? new Set(options.types) : undefined
  return built
    .map((b) => b.summary)
    .filter((s) => !wanted || wanted.has(s.activity_type))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
}

const serializeLink = (l: WorkoutLinkRow): WorkoutLink => ({
  confidence: l.confidence,
  created_at: l.created_at.toISOString(),
  linked_id: l.linked_id,
  method: l.method,
  primary_id: l.primary_id,
  reasons: l.reasons,
  status: l.status,
})

const toManual = (a: Activity, tz: string, restore?: Record<string, unknown> | null): ManualWorkout => {
  const start = restore?.start_time ? new Date(restore.start_time as string) : a.start_time
  const source =
    (restore?.time_source as TimeSource | undefined) ?? (a.data?.time_source as TimeSource | undefined)
  return {
    end_time: restore ? undefined : a.end_time,
    local_date: localDateOf(start, tz),
    start_time: start,
    time_source: source === 'explicit' || source === 'date_only' ? source : 'message_time',
  }
}

const toCandidate = (a: Activity, tz: string): CandidateSession => ({
  activity_type: a.activity_type,
  end_time: a.end_time,
  id: a.id!,
  local_date: localDateOf(a.start_time, tz),
  start_time: a.start_time,
})

const suggestionFor = (a: Activity, confidence: number, reasons: string[]): WorkoutLinkSuggestion => ({
  activity_id: a.id!,
  activity_type: a.activity_type,
  confidence,
  end_time: a.end_time?.toISOString(),
  reasons,
  source: memberSource(a),
  start_time: a.start_time.toISOString(),
  title: a.title ?? undefined,
})

const findSuggestions = async (user: string, group: Group, tz: string): Promise<WorkoutLinkSuggestion[]> => {
  const memberIds = new Set(group.members.map((m) => m.id!))
  const manual = group.members.find(isManualStrength)
  const around = group.winner.start_time.getTime()
  const from = new Date(around - CANDIDATE_WINDOW_MS)
  const to = new Date(around + CANDIDATE_WINDOW_MS)
  const links = await getWorkoutLinksFor(user, [...memberIds])
  const decided = new Set(
    links.filter((l) => l.status !== 'suggested').flatMap((l) => [l.primary_id, l.linked_id]),
  )
  if (manual) {
    if (group.members.some((m) => !isManualStrength(m))) return []
    const candidates = (await getStrengthCandidates(user, from, to, [...STRENGTH_TYPES])).filter(
      (c) => !memberIds.has(c.id!) && !decided.has(c.id!),
    )
    return rankCandidates(
      toManual(manual, tz),
      candidates.map((c) => toCandidate(c, tz)),
    ).map((r) => suggestionFor(candidates.find((c) => c.id === r.candidate.id)!, r.confidence, r.reasons))
  }
  if (!STRENGTH_TYPES.has(group.winner.activity_type)) return []
  const manuals = (await getManualStrengthWorkouts(user, from, to)).filter(
    (m) => !memberIds.has(m.id!) && !decided.has(m.id!) && !m.linked_ids?.length,
  )
  const target = toCandidate(group.winner, tz)
  return manuals
    .map((m) => ({ m, ...scoreMatch(toManual(m, tz), target) }))
    .filter((r) => r.confidence >= SUGGEST_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
    .map((r) => suggestionFor(r.m, r.confidence, r.reasons))
}

const findGroupContaining = async (user: string, id: string): Promise<{ built: Built } | null> => {
  const [activity] = await getActivitiesByIds(user, [id])
  if (!activity || activity.deleted_at) return null
  const linkedIds = [...(activity.linked_ids ?? [])]
  const linked = await getActivitiesByIds(user, linkedIds)
  const times = [activity, ...linked].map((a) => a.start_time.getTime())
  const start = new Date(Math.min(...times) - 12 * 3600_000)
  const end = new Date(Math.max(...times) + 12 * 3600_000)
  const types = await loadTypes(user)
  const raw = await getExerciseActivitiesInRange(user, start, end)
  const group = groupWorkouts(raw, types).find((g) => g.members.some((m) => m.id === id))
  if (!group) return null
  const [built] = await buildWorkouts(user, [group], types)
  return built ? { built } : null
}

export const getWorkoutDetail = async (
  user: string,
  id: string,
  tz = DEFAULT_TZ,
): Promise<WorkoutDetail | null> => {
  const found = await findGroupContaining(user, id)
  if (!found) return null
  const { built } = found
  const { group } = built
  const links = await getWorkoutLinksFor(
    user,
    group.members.map((m) => m.id!),
  )
  return {
    ...built.summary,
    exercises: summarizeExercises(built.sets),
    heart_rate: built.hr,
    links: links.filter((l) => l.status !== 'suggested').map(serializeLink),
    provenance: built.provenance,
    sets: built.sets,
    sources_detail: group.members.map((m) => ({
      activity_id: m.id!,
      end_time: m.end_time?.toISOString(),
      external_id: m.external_id,
      role:
        m.id === group.winner.id
          ? 'primary'
          : m.linked_ids?.length || group.winner.linked_ids?.includes(m.id!)
            ? 'linked'
            : 'merged',
      source: memberSource(m),
      start_time: m.start_time.toISOString(),
      title: m.title ?? undefined,
    })),
    suggestions: await findSuggestions(user, group, tz),
    time_source:
      (group.members.find(isManualStrength)?.data?.time_source as string | undefined) ?? group.winner.source,
  }
}

// ---------------------------------------------------------------------------
// Linking

const STRENGTH_ARRAY = [...STRENGTH_TYPES]

/**
 * Confirm two activities are one workout. When the manual side's time was
 * only the message time (or only a date), it takes the synced session's times;
 * the original is kept on the link so an unlink restores it.
 */
// eslint-disable-next-line complexity -- validation and time adoption are one decision
export const linkWorkouts = async (
  user: string,
  aId: string,
  bId: string,
  opts: { method: 'auto' | 'user'; confidence?: number; reasons?: string[] } = { method: 'user' },
): Promise<WorkoutLink | { error: string }> => {
  if (aId === bId) return { error: 'Cannot link an activity to itself' }
  const rows = await getActivitiesByIds(user, [aId, bId])
  const a = rows.find((r) => r.id === aId)
  const b = rows.find((r) => r.id === bId)
  if (!a || !b || a.deleted_at || b.deleted_at) return { error: 'Activity not found' }
  const [primary, other] = isManualStrength(b) && !isManualStrength(a) ? [b, a] : [a, b]
  if (isManualStrength(primary) && isManualStrength(other)) {
    return { error: 'Both are manual workouts; add the sets to one of them instead' }
  }

  const existing = await getWorkoutLink(user, primary.id!, other.id!)
  let restore: Record<string, unknown> | null = existing?.restore ?? null
  const timeSource = primary.data?.time_source as string | undefined
  if (
    isManualStrength(primary) &&
    (timeSource === 'message_time' || timeSource === 'date_only') &&
    other.end_time
  ) {
    restore = {
      end_time: primary.end_time?.toISOString() ?? null,
      start_time: primary.start_time.toISOString(),
      time_source: timeSource,
    }
    await updateWorkoutRow(user, primary.id!, {
      data: { ...primary.data, time_source: 'linked' },
      end_time: other.end_time,
      start_time: other.start_time,
    })
  }
  const link = await upsertWorkoutLink(user, {
    confidence: opts.confidence ?? 1,
    linked_id: other.id!,
    method: opts.method,
    primary_id: primary.id!,
    reasons: opts.reasons ?? ['confirmed by user'],
    restore,
    status: 'confirmed',
  })
  await materializeSuperseded(user, primary.start_time)
  await materializeSuperseded(user, other.start_time)
  return serializeLink(link)
}

/** Separate two activities for good: the link becomes `rejected`, which also stops the automatic merge. */
export const unlinkWorkouts = async (
  user: string,
  aId: string,
  bId: string,
): Promise<WorkoutLink | { error: string }> => {
  const rows = await getActivitiesByIds(user, [aId, bId])
  if (rows.length < 2) return { error: 'Activity not found' }
  const existing = await getWorkoutLink(user, aId, bId)
  const primaryId = existing?.primary_id ?? aId
  const linkedId = existing?.linked_id ?? bId
  const primary = rows.find((r) => r.id === primaryId)!
  if (existing?.restore && isManualStrength(primary)) {
    await updateWorkoutRow(user, primary.id!, {
      data: { ...primary.data, time_source: existing.restore.time_source },
      end_time: existing.restore.end_time ? new Date(existing.restore.end_time as string) : null,
      start_time: new Date(existing.restore.start_time as string),
    })
  }
  const link = await upsertWorkoutLink(user, {
    confidence: existing?.confidence ?? 0,
    linked_id: linkedId,
    method: 'user',
    primary_id: primaryId,
    reasons: ['unlinked by user'],
    restore: null,
    status: 'rejected',
  })
  for (const r of rows) await materializeSuperseded(user, r.start_time)
  if (existing?.restore) await materializeSuperseded(user, new Date(existing.restore.start_time as string))
  return serializeLink(link)
}

/**
 * Link manual strength workouts around `around` to their synced session when
 * the match is confident and unique; record weaker matches as suggestions.
 * Safe to re-run after every sync: user decisions are never revisited, and an
 * automatic link whose session moved away (Oura corrected its times) drops
 * back to a suggestion.
 */
// eslint-disable-next-line complexity -- one pass deciding link, demote or suggest per workout
export const reconcileStrengthWorkouts = async (
  user: string,
  around: Date,
  tz = DEFAULT_TZ,
): Promise<{ linked: number; suggested: number; demoted: number }> => {
  const from = new Date(around.getTime() - 24 * 3600_000)
  const to = new Date(around.getTime() + 24 * 3600_000)
  const manuals = await getManualStrengthWorkouts(user, from, to)
  const outcome = { demoted: 0, linked: 0, suggested: 0 }
  if (manuals.length === 0) return outcome

  const candidates = await getStrengthCandidates(
    user,
    new Date(from.getTime() - CANDIDATE_WINDOW_MS),
    new Date(to.getTime() + CANDIDATE_WINDOW_MS),
    STRENGTH_ARRAY,
  )
  const links = await getWorkoutLinksFor(user, [
    ...manuals.map((m) => m.id!),
    ...candidates.map((c) => c.id!),
  ])
  const claimed = new Set(links.filter((l) => l.status === 'confirmed').map((l) => l.linked_id))

  for (const manual of manuals) {
    const mine = links.filter((l) => l.primary_id === manual.id || l.linked_id === manual.id)
    const confirmed = mine.find((l) => l.status === 'confirmed')
    if (confirmed) {
      if (confirmed.method === 'user') continue
      const session = candidates.find((c) => c.id === confirmed.linked_id)
      const score = session
        ? scoreMatch(toManual(manual, tz, confirmed.restore), toCandidate(session, tz))
        : undefined
      if (!score || score.confidence < 0.5) {
        await unlinkWorkouts(user, manual.id!, confirmed.linked_id)
        await upsertWorkoutLink(user, {
          confidence: score?.confidence ?? 0,
          linked_id: confirmed.linked_id,
          method: 'auto',
          primary_id: manual.id!,
          reasons: [...(score?.reasons ?? []), 'session times changed after linking'],
          restore: null,
          status: 'suggested',
        })
        claimed.delete(confirmed.linked_id)
        outcome.demoted++
      }
      continue
    }
    const rejected = new Set(
      mine
        .filter((l) => l.status === 'rejected')
        .map((l) => (l.primary_id === manual.id ? l.linked_id : l.primary_id)),
    )
    const open = candidates.filter((c) => !rejected.has(c.id!) && !claimed.has(c.id!))
    const ranked = rankCandidates(
      toManual(manual, tz),
      open.map((c) => toCandidate(c, tz)),
    )
    const best = ranked[0]
    if (best && best.confidence >= AUTO_LINK_CONFIDENCE) {
      const result = await linkWorkouts(user, manual.id!, best.candidate.id, {
        confidence: best.confidence,
        method: 'auto',
        reasons: best.reasons,
      })
      if (!('error' in result)) {
        claimed.add(best.candidate.id)
        outcome.linked++
      }
      await deleteSuggestedLinks(user, manual.id!, [best.candidate.id])
      continue
    }
    for (const r of ranked) {
      await upsertWorkoutLink(user, {
        confidence: r.confidence,
        linked_id: r.candidate.id,
        method: 'auto',
        primary_id: manual.id!,
        reasons: r.reasons,
        status: 'suggested',
      })
      outcome.suggested++
    }
    await deleteSuggestedLinks(
      user,
      manual.id!,
      ranked.map((r) => r.candidate.id),
    )
  }
  return outcome
}

// ---------------------------------------------------------------------------
// Logging and editing sets

const toKg = (weight: number | undefined, unit: 'kg' | 'lb' | undefined): number | null =>
  weight === undefined ? null : unit === 'lb' ? lbToKg(weight) : weight

const zonedInstant = (date: string, time: string, tz: string): Date =>
  new Date(
    Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(tz, { disambiguation: 'compatible' })
      .epochMilliseconds,
  )

export interface EntryTime {
  start: Date
  time_source: TimeSource
  local_date: string
}

/**
 * When the logged sets happened. An explicit time wins; a date without one
 * (e.g. "yesterday") is pinned to local noon and marked `date_only`; with
 * neither, the message time is used and marked so a later link may correct it.
 */
export const resolveEntryTime = (
  input: { performed_at?: string; date?: string; message_time?: string; parsed?: ParsedStrengthText },
  now: Date,
  tz: string,
): EntryTime => {
  if (input.performed_at) {
    const start = new Date(input.performed_at)
    return { local_date: localDateOf(start, tz), start, time_source: 'explicit' }
  }
  const messageTime = input.message_time ? new Date(input.message_time) : now
  const today = localDateOf(messageTime, tz)
  const date = input.date ?? input.parsed?.date
  if (input.parsed?.time) {
    const day = date ?? today
    return { local_date: day, start: zonedInstant(day, input.parsed.time, tz), time_source: 'explicit' }
  }
  if (date && date !== today) {
    return { local_date: date, start: zonedInstant(date, '12:00', tz), time_source: 'date_only' }
  }
  return { local_date: today, start: messageTime, time_source: 'message_time' }
}

const buildSet = (
  exercise: { key: string; name: string },
  input: StrengthSetInput,
  order: number,
  exerciseOrder: number,
  channel: string,
  loggedAt: Date,
): StrengthSet => ({
  ...(input.bodyweight ? { bodyweight: true } : {}),
  distance: input.distance ?? null,
  exercise: exercise.name,
  exercise_key: exercise.key,
  exercise_order: exerciseOrder,
  logged_at: loggedAt.toISOString(),
  logged_via: channel as StrengthSet['logged_via'],
  notes: input.notes ?? null,
  order,
  reps: input.reps ?? null,
  rpe: input.rpe ?? null,
  set_id: randomUUID(),
  set_type: input.set_type ?? 'normal',
  time: input.time ?? null,
  weight: toKg(input.weight, input.weight_unit),
})

/** Append sets, numbering each exercise's sets on from where the workout left off. */
export const appendSets = (
  existing: StrengthSet[],
  exercises: { key: string; name: string; sets: StrengthSetInput[] }[],
  channel: string,
  loggedAt: Date,
): { sets: StrengthSet[]; added: StrengthSet[] } => {
  const sets = [...existing]
  const added: StrengthSet[] = []
  for (const exercise of exercises) {
    const same = sets.filter((s) => (s.exercise_key ?? s.exercise) === exercise.key)
    const exerciseOrder =
      same[0]?.exercise_order ?? Math.max(0, ...sets.map((s) => s.exercise_order ?? 0)) + 1
    let order = Math.max(0, ...same.map((s) => s.order))
    for (const input of exercise.sets) {
      const set = buildSet(exercise, input, ++order, exerciseOrder, channel, loggedAt)
      sets.push(set)
      added.push(set)
    }
  }
  return { added, sets }
}

const derivedFields = (sets: StrengthSet[]) => ({
  exercise_count: new Set(sets.map((s) => s.exercise_key ?? s.exercise)).size,
  set_count: sets.length,
  volume_kg: totalVolume(sets),
})

const dayLabel = (date: string, tz: string, now: Date): string => {
  const today = localDateOf(now, tz)
  if (date === today) return 'Today'
  if (date === shiftDate(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    weekday: 'short',
  }).format(new Date(`${date}T12:00:00Z`))
}

const clock = (iso: string | undefined, tz: string): string =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
        new Date(iso),
      )
    : '?'

export const formatWorkoutReply = (
  workout: WorkoutDetail,
  opts: { created: boolean; tz: string; now: Date; unparsed?: string[]; dryRun?: boolean },
): string => {
  const date = localDateOf(new Date(workout.start_time), opts.tz)
  const head = opts.dryRun
    ? `📝 Preview — nothing saved — ${dayLabel(date, opts.tz, opts.now)}`
    : `✅ Strength workout ${opts.created ? 'logged' : 'updated'} — ${dayLabel(date, opts.tz, opts.now)}`
  const lines = [
    head,
    '',
    formatWorkoutSets(workout.sets),
    '',
    `Total volume: ${formatVolume(workout.volume_kg)}`,
  ]
  const synced = workout.sources_detail.find(
    (s) => s.role !== 'primary' && s.source !== 'hermes' && s.source !== 'web',
  )
  if (synced) {
    lines.push(
      `🔗 Merged with ${sourceLabel(synced.source)} session ${clock(synced.start_time, opts.tz)}–${clock(synced.end_time, opts.tz)}`,
    )
  }
  const suggestion = workout.suggestions[0]
  if (!synced && suggestion) {
    lines.push(
      `❓ Possibly the ${sourceLabel(suggestion.source)} session ${clock(suggestion.start_time, opts.tz)}–${clock(suggestion.end_time, opts.tz)} — not merged; confirm in Aurboda if it is the same workout`,
    )
  }
  if (workout.time_source === 'date_only') lines.push('🕑 No time given — logged for that day without a time')
  if (opts.unparsed?.length) lines.push(`⚠️ Not understood: ${opts.unparsed.map((u) => `"${u}"`).join(', ')}`)
  return lines.join('\n')
}

const requestHash = (body: LogStrengthBody): string => {
  const { idempotency_key: _key, ...rest } = body
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex')
}

const IDEMPOTENCY_SCOPE = 'strength_log'

const waitForReplay = async (user: string, key: string): Promise<LogStrengthResult | null> => {
  for (let i = 0; i < 20; i++) {
    const record = await getIdempotencyRecord(user, IDEMPOTENCY_SCOPE, key)
    if (!record) return null
    if (!record.response.pending) {
      return { ...(record.response as unknown as LogStrengthResult), replayed: true }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

export type LogStrengthOutcome =
  | { ok: true; result: LogStrengthResult }
  | { ok: false; error: string; parsed?: ParsedStrengthText }

// eslint-disable-next-line complexity -- explicit target, then the grouping policy
const findTargetWorkout = async (
  user: string,
  body: LogStrengthBody,
  entry: EntryTime,
  tz: string,
): Promise<{ manual?: Activity; linkTo?: Activity } | { error: string }> => {
  if (body.workout_id) {
    const [row] = await getActivitiesByIds(user, [body.workout_id])
    if (!row || row.deleted_at) return { error: 'Workout not found' }
    if (isManualStrength(row)) return { manual: row }
    const linkedManualId = row.linked_ids?.[0]
    if (linkedManualId) {
      const [linked] = await getActivitiesByIds(user, [linkedManualId])
      if (linked && isManualStrength(linked) && !linked.deleted_at) return { manual: linked }
    }
    if (!STRENGTH_TYPES.has(row.activity_type)) {
      return { error: `Workout ${row.id} is ${row.activity_type}, not a strength session` }
    }
    return { linkTo: row }
  }
  if (body.grouping === 'new') return {}
  const dayStart = zonedInstant(entry.local_date, '00:00', tz)
  const dayEnd = zonedInstant(shiftDate(entry.local_date, 1), '00:00', tz)
  const sameDay = (await getManualStrengthWorkouts(user, dayStart, dayEnd)).filter(
    (w) => localDateOf(w.start_time, tz) === entry.local_date,
  )
  const lastTouched = (w: Activity): number =>
    new Date((w.data?.last_logged_at as string) ?? w.start_time).getTime()
  const latest = sameDay.sort((a, b) => lastTouched(b) - lastTouched(a))[0]
  if (!latest) return {}
  if (body.grouping === 'append_latest' || entry.time_source === 'date_only') return { manual: latest }
  return Math.abs(entry.start.getTime() - lastTouched(latest)) <= SESSION_GAP_MS ? { manual: latest } : {}
}

// eslint-disable-next-line complexity -- the logging flow: replay, parse, place in time, group, write, link
export const logStrength = async (
  user: string,
  body: LogStrengthBody,
  now = new Date(),
): Promise<LogStrengthOutcome> => {
  const tz = body.tz ?? DEFAULT_TZ
  const key = body.idempotency_key
  if (key && !body.dry_run) {
    const claimed = await claimIdempotencyKey(user, IDEMPOTENCY_SCOPE, key, requestHash(body))
    if (claimed) {
      const replay = claimed.response.pending
        ? await waitForReplay(user, key)
        : { ...(claimed.response as unknown as LogStrengthResult), replayed: true }
      if (replay) return { ok: true, result: replay }
      return { error: 'A request with this idempotency key is still being processed', ok: false }
    }
  }

  try {
    const outcome = await logStrengthUnguarded(user, body, now, tz)
    if (key && !body.dry_run) {
      if (outcome.ok) {
        await completeIdempotencyKey(
          user,
          IDEMPOTENCY_SCOPE,
          key,
          outcome.result as unknown as Record<string, unknown>,
        )
      } else await releaseIdempotencyKey(user, IDEMPOTENCY_SCOPE, key)
    }
    return outcome
  } catch (error) {
    if (key && !body.dry_run) await releaseIdempotencyKey(user, IDEMPOTENCY_SCOPE, key)
    throw error
  }
}

// eslint-disable-next-line complexity -- see logStrength
const logStrengthUnguarded = async (
  user: string,
  body: LogStrengthBody,
  now: Date,
  tz: string,
): Promise<LogStrengthOutcome> => {
  const { index } = await loadExerciseIndex(user)
  const parsed = body.exercises?.length
    ? undefined
    : parseStrengthText(body.text ?? '', {
        index,
        now: body.message_time ? new Date(body.message_time) : now,
        tz,
      })
  const exercises = body.exercises?.length
    ? body.exercises.map((e) => {
        const r = resolveExercise(e.exercise, index)
        return {
          key: r.key,
          name: r.name,
          sets: r.is_bodyweight
            ? e.sets.map((s) =>
                s.weight === undefined ? { ...s, bodyweight: true, weight: 0 } : { ...s, bodyweight: true },
              )
            : e.sets,
        }
      })
    : parsed!.exercises.map((e) => ({ key: e.exercise_key, name: e.exercise, sets: e.sets }))
  if (exercises.length === 0) return { error: 'No sets could be read from the message', ok: false, parsed }

  const entry = resolveEntryTime({ ...body, parsed }, now, tz)
  const channel = body.entry_channel ?? 'api'

  if (body.dry_run) {
    const { sets } = appendSets([], exercises, channel, now)
    const preview: WorkoutDetail = {
      activity_type: 'strength_training',
      color: '#3b82f6',
      display_name: 'Strength Training',
      exercise_count: exercises.length,
      exercises: summarizeExercises(sets),
      heart_rate: { coverage: 0, overlapping_activity_ids: [], sample_count: 0, status: 'unavailable' },
      id: '',
      links: [],
      member_ids: [],
      provenance: { sets: channel },
      set_count: sets.length,
      sets,
      sets_status: 'logged',
      sources: [channel],
      sources_detail: [],
      start_time: entry.start.toISOString(),
      suggestions: [],
      time_source: entry.time_source,
      volume_kg: totalVolume(sets),
    }
    return {
      ok: true,
      result: {
        added_set_ids: [],
        created: false,
        dry_run: true,
        parsed,
        replayed: false,
        summary_text: formatWorkoutReply(preview, {
          created: true,
          dryRun: true,
          now,
          tz,
          unparsed: parsed?.unparsed,
        }),
        workout: preview,
      },
    }
  }

  const target = await findTargetWorkout(user, body, entry, tz)
  if ('error' in target) return { error: target.error, ok: false, parsed }

  let workoutId: string
  let created = false
  let added: StrengthSet[]
  if (target.manual) {
    const appended = appendSets(setsOf(target.manual), exercises, channel, now)
    added = appended.added
    workoutId = target.manual.id!
    await updateWorkoutRow(user, workoutId, {
      data: {
        ...target.manual.data,
        ...derivedFields(appended.sets),
        last_logged_at: now.toISOString(),
        sets: appended.sets,
      },
      ...(body.end_time ? { end_time: new Date(body.end_time) } : {}),
    })
    if (body.notes) {
      const existing = (await getActivityNotes(user, [workoutId])).get(workoutId) ?? []
      await replaceUserNotes(
        user,
        'activity',
        workoutId,
        [...existing, body.notes].join('\n'),
        target.manual.start_time,
        target.manual.end_time,
      )
    }
    await materializeSuperseded(user, target.manual.start_time)
  } else {
    const appended = appendSets([], exercises, channel, now)
    added = appended.added
    workoutId = randomUUID()
    created = true
    await insertActivity(user, {
      activity_type: 'strength_training',
      data: {
        ...derivedFields(appended.sets),
        entry_channel: channel,
        last_logged_at: now.toISOString(),
        manual_strength: true,
        ...(body.message_time ? { message_time: body.message_time } : {}),
        sets: appended.sets,
        time_source: entry.time_source,
      },
      end_time: body.end_time ? new Date(body.end_time) : undefined,
      external_id: `manual-strength-${workoutId}`,
      id: workoutId,
      source: 'aurboda',
      start_time: entry.start,
      title: body.title ?? 'Strength Training',
    })
    if (body.notes) await replaceUserNotes(user, 'activity', workoutId, body.notes, entry.start, undefined)
  }

  let link: WorkoutLink | undefined
  if (target.linkTo) {
    const result = await linkWorkouts(user, workoutId, target.linkTo.id!, {
      method: 'user',
      reasons: ['sets added to this session'],
    })
    if (!('error' in result)) link = result
  } else {
    await reconcileStrengthWorkouts(user, entry.start, tz)
    const links = await getWorkoutLinksFor(user, [workoutId])
    const confirmed = links.find((l) => l.status === 'confirmed')
    if (confirmed) link = serializeLink(confirmed)
  }

  const workout = await getWorkoutDetail(user, workoutId, tz)
  if (!workout) return { error: 'Workout was written but could not be read back', ok: false }
  return {
    ok: true,
    result: {
      added_set_ids: added.map((s) => s.set_id!),
      created,
      dry_run: false,
      link,
      parsed,
      replayed: false,
      summary_text: formatWorkoutReply(workout, { created, now, tz, unparsed: parsed?.unparsed }),
      workout,
    },
  }
}

const findSetOwner = async (
  user: string,
  workoutId: string,
  setId: string,
): Promise<Activity | { error: string }> => {
  const [row] = await getActivitiesByIds(user, [workoutId])
  if (!row || row.deleted_at) return { error: 'Workout not found' }
  const candidates = [row, ...(await getActivitiesByIds(user, row.linked_ids ?? []))]
  const owner = candidates.find((a) => setsOf(a).some((s) => s.set_id === setId))
  if (!owner) return { error: 'Set not found' }
  if (!isManualStrength(owner)) return { error: `Sets synced from ${owner.source} are edited at the source` }
  return owner
}

export const updateStrengthSet = async (
  user: string,
  workoutId: string,
  setId: string,
  patch: UpdateStrengthSetBody,
  tz = DEFAULT_TZ,
): Promise<{ workout: WorkoutDetail } | { error: string }> => {
  const owner = await findSetOwner(user, workoutId, setId)
  if ('error' in owner) return owner
  const { index } = await loadExerciseIndex(user)
  const sets = setsOf(owner).map((set) => {
    if (set.set_id !== setId) return set
    const next: StrengthSet = { ...set }
    if (patch.exercise !== undefined) {
      const r = resolveExercise(patch.exercise, index)
      next.exercise = r.name
      next.exercise_key = r.key
    }
    if (patch.weight !== undefined) {
      next.weight = patch.weight === null ? null : toKg(patch.weight, patch.weight_unit)
    }
    if (patch.reps !== undefined) next.reps = patch.reps
    if (patch.time !== undefined) next.time = patch.time
    if (patch.distance !== undefined) next.distance = patch.distance
    if (patch.rpe !== undefined) next.rpe = patch.rpe
    if (patch.set_type !== undefined) next.set_type = patch.set_type
    if (patch.notes !== undefined) next.notes = patch.notes
    if (patch.bodyweight !== undefined) next.bodyweight = patch.bodyweight
    return next
  })
  await updateWorkoutRow(user, owner.id!, { data: { ...owner.data, ...derivedFields(sets), sets } })
  const workout = await getWorkoutDetail(user, owner.id!, tz)
  return workout ? { workout } : { error: 'Workout not found' }
}

export const deleteStrengthSet = async (
  user: string,
  workoutId: string,
  setId: string,
  tz = DEFAULT_TZ,
): Promise<{ workout: WorkoutDetail } | { error: string }> => {
  const owner = await findSetOwner(user, workoutId, setId)
  if ('error' in owner) return owner
  const sets = setsOf(owner).filter((s) => s.set_id !== setId)
  await updateWorkoutRow(user, owner.id!, { data: { ...owner.data, ...derivedFields(sets), sets } })
  const workout = await getWorkoutDetail(user, owner.id!, tz)
  return workout ? { workout } : { error: 'Workout not found' }
}

// ---------------------------------------------------------------------------
// Progression

export const strengthProgress = async (
  user: string,
  exercise: string,
  opts: { start?: Date; end?: Date; tz?: string },
): Promise<StrengthProgress> => {
  const { index } = await loadExerciseIndex(user)
  const resolved = resolveExercise(exercise, index)
  const rows = await getActivitiesWithSets(user, opts.start, opts.end)
  const workouts = rows.map((a) => ({
    sets: setsOf(a).map((s) => ({
      ...s,
      exercise_key: s.exercise_key ?? resolveExercise(s.exercise, index).key,
    })),
    start_time: a.start_time,
    workout_id: a.id!,
  }))
  return buildProgress({ key: resolved.key, name: resolved.name }, workouts, opts.tz ?? DEFAULT_TZ)
}
