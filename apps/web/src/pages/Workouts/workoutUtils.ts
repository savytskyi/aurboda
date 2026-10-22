import type { WorkoutSummary } from '@aurboda/api-spec'

/** `YYYY-MM-DD` of an instant in the viewer's zone. */
export const localDay = (iso: string | Date): string => {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const parseDay = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

export const addDays = (day: string, n: number): string => {
  const d = parseDay(day)
  d.setDate(d.getDate() + n)
  return localDay(d)
}

/** Monday of the day's week. */
export const weekStartOf = (day: string): string => {
  const d = parseDay(day)
  return addDays(day, -((d.getDay() + 6) % 7))
}

export const groupByDay = (workouts: WorkoutSummary[]): Map<string, WorkoutSummary[]> => {
  const byDay = new Map<string, WorkoutSummary[]>()
  for (const w of workouts) {
    const day = localDay(w.start_time)
    const list = byDay.get(day) ?? []
    list.push(w)
    byDay.set(day, list)
  }
  return byDay
}

export interface CalendarMonth {
  key: string
  label: string
  /** Six rows of seven days (Monday first); null pads days outside the month. */
  weeks: (string | null)[][]
}

/** Month grids covering `[from, to]`, oldest first. */
export const calendarMonths = (from: string, to: string): CalendarMonth[] => {
  const months: CalendarMonth[] = []
  let cursor = parseDay(from)
  cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const last = parseDay(to)
  while (cursor <= last) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const first = localDay(cursor)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const lead = (cursor.getDay() + 6) % 7
    const cells: (string | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 0; d < daysInMonth; d++) cells.push(addDays(first, d))
    while (cells.length % 7 !== 0) cells.push(null)
    const weeks: (string | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    months.push({
      key: `${year}-${month}`,
      label: cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      weeks,
    })
    cursor = new Date(year, month + 1, 1)
  }
  return months
}

export interface TypeInfo {
  type: string
  name: string
  color: string
}

/** Workout types present, most frequent first. */
export const typesIn = (workouts: WorkoutSummary[]): TypeInfo[] => {
  const counts = new Map<string, { info: TypeInfo; n: number }>()
  for (const w of workouts) {
    const entry = counts.get(w.activity_type) ?? {
      info: { color: w.color, name: w.display_name, type: w.activity_type },
      n: 0,
    }
    entry.n++
    counts.set(w.activity_type, entry)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((e) => e.info)
}

/** Monday-first week starts from the week containing `from` through the one containing `to`. */
export const weeksBetween = (from: string, to: string): string[] => {
  const weeks: string[] = []
  for (let w = weekStartOf(from); w <= to; w = addDays(w, 7)) weeks.push(w)
  return weeks
}

export interface WeeklySeries {
  type: TypeInfo
  values: Map<string, number>
}

/**
 * Per-week value for each type. Each workout is one merged session, so a
 * walk and its step count or an Oura session and its Hermes sets are
 * counted once.
 */
export const weeklyByType = (
  workouts: WorkoutSummary[],
  value: (w: WorkoutSummary) => number,
): WeeklySeries[] =>
  typesIn(workouts).map((type) => {
    const values = new Map<string, number>()
    for (const w of workouts.filter((x) => x.activity_type === type.type)) {
      const week = weekStartOf(localDay(w.start_time))
      values.set(week, (values.get(week) ?? 0) + value(w))
    }
    return { type, values }
  })

/** Distinct days with at least one workout, per week. */
export const trainingDaysPerWeek = (workouts: WorkoutSummary[]): Map<string, number> => {
  const days = new Map<string, Set<string>>()
  for (const w of workouts) {
    const day = localDay(w.start_time)
    const week = weekStartOf(day)
    const set = days.get(week) ?? new Set()
    set.add(day)
    days.set(week, set)
  }
  return new Map([...days.entries()].map(([week, set]) => [week, set.size]))
}

/** Total seconds per HR zone over workouts that have zone data, and how many did. */
export const zoneTotals = (workouts: WorkoutSummary[]): { secs: number[]; covered: number } => {
  const secs = [0, 0, 0, 0, 0, 0]
  let covered = 0
  for (const w of workouts) {
    if (!w.zone_secs) continue
    covered++
    for (let z = 0; z <= 5; z++) secs[z]! += w.zone_secs[z as 0 | 1 | 2 | 3 | 4 | 5] ?? 0
  }
  return { covered, secs }
}

export const formatMinutes = (minutes: number | undefined): string => {
  if (minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

export const sourceName = (source: string): string =>
  ({
    api: 'API',
    aurboda: 'Aurboda',
    garmin: 'Garmin',
    gravl: 'Gravl',
    health_connect: 'Health Connect',
    hermes: 'Hermes',
    mcp: 'MCP',
    oura: 'Oura',
    strava: 'Strava',
    web: 'Web',
  })[source] ?? source

/**
 * A strength session either has its sets logged (Hermes, web, Gravl) or is a
 * synced session with nothing logged yet (typically Oura-only); other
 * workouts carry no sets by nature.
 */
export const logState = (w: WorkoutSummary): 'logged' | 'unlogged' | 'none' =>
  w.sets_status === 'not_logged' ? 'unlogged' : w.sets_status === 'logged' ? 'logged' : 'none'

/** Solid for logged and non-strength workouts, an outline in the type colour for unlogged strength. */
export const markStyle = (w: WorkoutSummary): Record<string, string> =>
  logState(w) === 'unlogged'
    ? { background: 'transparent', boxShadow: `inset 0 0 0 2px ${w.color}` }
    : { background: w.color }

export const markLabel = (w: WorkoutSummary): string => {
  const state = logState(w)
  if (state === 'unlogged') {
    return `${w.display_name} — sets not logged (${w.sources.map(sourceName).join(' + ')} only)`
  }
  if (state === 'logged') return `${w.display_name} — ${w.set_count} sets logged`
  return w.display_name
}

/** Strength sessions in the list with and without logged sets. */
export const strengthLogCounts = (workouts: WorkoutSummary[]): { logged: number; unlogged: number } => ({
  logged: workouts.filter((w) => logState(w) === 'logged').length,
  unlogged: workouts.filter((w) => logState(w) === 'unlogged').length,
})
