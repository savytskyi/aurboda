import type { HealthDailyPoint, WorkoutSummary } from '@aurboda/api-spec'

import { activityContributorMetrics } from '@aurboda/api-spec'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'preact/hooks'

import { HrZonesWidget } from '../../components/widgets/HrZonesWidget'
import { fetchGoalsProgress, fetchWorkouts } from '../../state/api'
import { WorkoutBadge } from '../Workouts/WorkoutBadge'
import { localDay } from '../Workouts/workoutUtils'
import {
  INTENSITY_CHIPS,
  intensityCountsText,
  stepsGoalPerDay,
  stepsSummaryText,
  targetProgressByDay,
  workoutTotals,
} from './activityModel'
import { DailyBarChart, type DailyBarSeries } from './DailyBarChart'
import {
  addDays,
  axisTickLabel,
  baselineDeltaTone,
  formatDelta,
  formatDuration,
  formatMetricValue,
  parseDay,
  shortDate,
} from './format'
import { HealthNav } from './HealthNav'
import { SERIES_COLORS } from './MetricTrendCard'
import { normalRangeText } from './overviewModel'
import { RangeSelector, RANGE_OPTIONS } from './RangeSelector'
import { ScoreBars } from './ScoreBars'
import { latestDate, latestDelta, latestPoint, rangeAverage, valueOn } from './series'
import { StatusChip } from './StatusChip'
import { TrendChart } from './TrendChart'
import { daysBetween } from './trendChartUtils'
import { useHealthDaily } from './useHealthDaily'
import { useRange } from './useRange'
import './health.css'

const INTENSITY = [
  { color: SERIES_COLORS[1], label: 'High', metric: 'high_activity_time_sec' },
  { color: SERIES_COLORS[3], label: 'Medium', metric: 'medium_activity_time_sec' },
  { color: SERIES_COLORS[0], label: 'Low', metric: 'low_activity_time_sec' },
] as const

const METRICS = [
  'activity_score',
  ...activityContributorMetrics,
  'steps',
  'meters_to_target',
  'activity_target_meters',
  ...INTENSITY.map((i) => i.metric),
  'sedentary_time_sec',
  'inactivity_alerts',
]

type SeriesMap = Map<string, HealthDailyPoint[]>

const valuesOf = (points: readonly HealthDailyPoint[] | undefined): Map<string, number> =>
  new Map((points ?? []).map((p) => [p.date, p.value]))

const sum = (points: readonly HealthDailyPoint[] | undefined): number =>
  (points ?? []).reduce((total, p) => total + p.value, 0)

const durationTick = (v: number) => axisTickLabel('sedentary_time_sec', v)

function ScoreSection({ series, start, end }: { series: SeriesMap; start: string; end: string }) {
  const points = series.get('activity_score') ?? []
  const latest = latestPoint(points)
  const delta = latestDelta(points)
  const contributorDate = latestDate(activityContributorMetrics.map((m) => series.get(m)))
  return (
    <>
      <section class="health-card">
        <div class="health-tile-label">Activity score</div>
        <div class="health-hero">{formatMetricValue('activity_score', latest?.value ?? null)}</div>
        {delta !== null && (
          <div
            class={`health-delta health-delta-${baselineDeltaTone('activity_score', delta, latest?.baseline)}`}
          >
            {formatDelta('activity_score', delta)} vs 30-day normal
          </div>
        )}
        <div class="health-tile-caption">
          {latest
            ? [shortDate(latest.date), normalRangeText('activity_score', latest.baseline)]
                .filter(Boolean)
                .join(' · ')
            : 'No activity score in this range'}
        </div>
        <TrendChart
          series={[{ color: SERIES_COLORS[0], label: 'Activity score', metric: 'activity_score', points }]}
          start={start}
          end={end}
        />
      </section>

      <section class="health-card">
        <div class="health-card-header">
          <h2>Activity score contributors</h2>
          {contributorDate && <span class="health-muted">{shortDate(contributorDate)}</span>}
        </div>
        {contributorDate === null ? (
          <p class="health-muted">No contributor scores in this range yet.</p>
        ) : (
          <ScoreBars
            items={activityContributorMetrics.map((metric) => ({
              average: rangeAverage(series.get(metric)),
              metric,
              value: valueOn(series.get(metric), contributorDate),
            }))}
          />
        )}
        <div class="health-caption">
          Training frequency and volume look at the last 7 days; recovery time at rest days.
        </div>
      </section>
    </>
  )
}

function StepsSection({ series, dates }: { series: SeriesMap; dates: string[] }) {
  const goals = useQuery({
    queryFn: fetchGoalsProgress,
    queryKey: ['goalsProgress'],
    staleTime: 5 * 60 * 1000,
  })
  const steps = series.get('steps') ?? []
  const targets = useMemo(
    () =>
      targetProgressByDay(series.get('meters_to_target') ?? [], series.get('activity_target_meters') ?? []),
    [series],
  )
  const markers = useMemo(
    () => new Map([...targets].filter(([, t]) => t.met).map(([date]) => [date, '✓'])),
    [targets],
  )
  const barSeries = useMemo<DailyBarSeries[]>(
    () => [{ color: SERIES_COLORS[0], key: 'steps', label: 'Steps', values: valuesOf(steps) }],
    [steps],
  )
  const goalPerDay = stepsGoalPerDay(goals.data)
  const summary = stepsSummaryText(steps, targets)
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>Steps vs target</h2>
        {summary && <span class="health-muted">{summary}</span>}
      </div>
      <DailyBarChart
        dates={dates}
        series={barSeries}
        formatValue={(v) => `${formatMetricValue('steps', v)} steps`}
        formatTick={(v) => axisTickLabel('steps', v)}
        markers={markers}
        markerLegend={markers.size > 0 ? '✓ Oura daily target met' : undefined}
        referenceLine={
          goalPerDay === null
            ? undefined
            : { label: `Goal ${formatMetricValue('steps', goalPerDay)}/day`, value: goalPerDay }
        }
        tooltipNote={(date) => {
          const t = targets.get(date)
          if (!t) return null
          return t.met ? 'Oura daily target met' : `${Math.round(t.progress * 100)}% of Oura daily target`
        }}
        ariaLabel={`Daily steps. ${summary ?? 'No step data.'}`}
      />
      <div class="health-caption">
        Oura's daily target is a walking-equivalent distance that also counts other movement, so a day can
        meet it with fewer steps.
      </div>
    </section>
  )
}

function IntensitySection({ series, dates }: { series: SeriesMap; dates: string[] }) {
  const stacked = useMemo<DailyBarSeries[]>(
    () =>
      INTENSITY.map((i) => ({
        color: i.color,
        key: i.metric,
        label: i.label,
        values: valuesOf(series.get(i.metric)),
      })),
    [series],
  )
  const sedentary = useMemo<DailyBarSeries[]>(
    () => [
      {
        color: SERIES_COLORS[0],
        key: 'sedentary_time_sec',
        label: 'Sedentary',
        values: valuesOf(series.get('sedentary_time_sec')),
      },
    ],
    [series],
  )
  const alerts = useMemo(() => valuesOf(series.get('inactivity_alerts')), [series])
  const alertMarkers = useMemo(
    () => new Map([...alerts].filter(([, n]) => n > 0).map(([date, n]) => [date, String(n)])),
    [alerts],
  )
  const totals = INTENSITY.map((i) => `${i.label} ${formatDuration(sum(series.get(i.metric)))}`).join(' · ')
  const alertTotal = sum(series.get('inactivity_alerts'))
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>Time by intensity</h2>
        <span class="health-muted">{totals} in this range</span>
      </div>
      <DailyBarChart
        dates={dates}
        series={stacked}
        formatValue={formatDuration}
        formatTick={durationTick}
        tickUnit={3600}
        ariaLabel={`Daily activity time by intensity. Totals: ${totals}.`}
      />
      <h3 class="health-subheading">Sedentary time</h3>
      <DailyBarChart
        dates={dates}
        series={sedentary}
        formatValue={formatDuration}
        formatTick={durationTick}
        tickUnit={3600}
        height={140}
        markers={alertMarkers}
        markerLegend={alertMarkers.size > 0 ? 'Number above a bar: inactivity alerts that day' : undefined}
        tooltipNote={(date) => {
          const n = alerts.get(date)
          return n === undefined ? null : `${n} inactivity alert${n === 1 ? '' : 's'}`
        }}
        ariaLabel={`Daily sedentary time, ${alertTotal} inactivity alerts in this range.`}
      />
    </section>
  )
}

/** Oura reports a few metres for stationary workouts (wrestling, strength); that is noise, not distance. */
const MIN_SHOWN_DISTANCE_M = 100
const WORKOUTS_SHOWN = 10

function WorkoutRow({ workout }: { workout: WorkoutSummary }) {
  const chip = workout.intensity ? INTENSITY_CHIPS[workout.intensity] : null
  const meta = [
    workout.duration_min === undefined ? null : formatDuration(workout.duration_min * 60),
    workout.calories === undefined ? null : `${Math.round(workout.calories)} kcal`,
    workout.distance === undefined || workout.distance < MIN_SHOWN_DISTANCE_M
      ? null
      : formatMetricValue('equivalent_walking_distance', workout.distance),
    workout.hr_avg === undefined ? null : `avg ${Math.round(workout.hr_avg)} bpm`,
  ].filter((p) => p !== null)
  return (
    <li>
      <a class="health-workout" href={`/workouts/${workout.id}`}>
        <WorkoutBadge icon={workout.icon} color={workout.color} size="sm" />
        <span class="health-workout-main">
          <span class="health-workout-name">{workout.title ?? workout.display_name}</span>
          <span class="health-muted">
            {shortDate(localDay(workout.start_time))}
            {meta.length > 0 && ` · ${meta.join(' · ')}`}
          </span>
        </span>
        {chip && <StatusChip tone={chip.tone} label={chip.label} icon={chip.icon} />}
      </a>
    </li>
  )
}

function WorkoutList({ workouts }: { workouts: WorkoutSummary[] }) {
  const [showAll, setShowAll] = useState(false)
  if (workouts.length === 0) return null
  return (
    <>
      <ul class="health-workouts">
        {(showAll ? workouts : workouts.slice(0, WORKOUTS_SHOWN)).map((w) => (
          <WorkoutRow key={w.id} workout={w} />
        ))}
      </ul>
      {workouts.length > WORKOUTS_SHOWN && (
        <button type="button" class="health-show-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${workouts.length} workouts`}
        </button>
      )}
    </>
  )
}

function WorkoutsSection({ start, end, days }: { start: string; end: string; days: number }) {
  const query = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchWorkouts(parseDay(start), parseDay(addDays(end, 1))),
    queryKey: ['workouts', start, end],
  })
  const workouts = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => b.start_time.localeCompare(a.start_time)),
    [query.data],
  )
  const totals = workoutTotals(workouts)
  const intensityText = intensityCountsText(totals.byIntensity)
  return (
    <section class={`health-card${query.isFetching && !query.isLoading ? ' is-refetching' : ''}`}>
      <div class="health-card-header">
        <h2>Workouts</h2>
        <span class="health-links">
          <a class="health-link" href="/workouts">
            Workout calendar →
          </a>
          <a class="health-link" href="/strength">
            Strength progress →
          </a>
        </span>
      </div>
      {query.isLoading && <p class="health-muted">Loading workouts…</p>}
      {query.isError && !query.data && <p class="health-error">Could not load workouts.</p>}
      {query.data && (
        <>
          <p class="health-muted">
            {totals.count === 0
              ? 'No workouts in this range.'
              : [
                  `${totals.count} workout${totals.count === 1 ? '' : 's'}`,
                  intensityText,
                  formatDuration(totals.durationMin * 60),
                  totals.calories > 0 ? `${Math.round(totals.calories)} kcal` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </p>
          {totals.strength.sessions > 0 && (
            <p class="health-muted">
              Strength: {totals.strength.sessions} session{totals.strength.sessions === 1 ? '' : 's'},{' '}
              {totals.strength.logged} with sets logged · {totals.strength.sets} sets ·{' '}
              {Math.round(totals.strength.volumeKg).toLocaleString('en-US')} kg volume
            </p>
          )}
          <WorkoutList workouts={workouts} />
        </>
      )}
      <div class="health-hr-zones">
        <HrZonesWidget config={{ lookback_days: days, show_targets: true }} />
      </div>
    </section>
  )
}

export function HealthActivity() {
  const { days, end, setDays, start } = useRange(RANGE_OPTIONS)
  const { error, isFetching, isLoading, isPlaceholderData, series } = useHealthDaily(METRICS, start, end)
  const dates = useMemo(() => daysBetween(start, end), [start, end])

  return (
    <div class="health-page">
      <HealthNav />
      <div class="health-header">
        <h1>Activity &amp; Training</h1>
        <RangeSelector value={days} onChange={setDays} />
      </div>

      {isLoading && <p class="health-muted">Loading activity data…</p>}
      {error && !isPlaceholderData && series.size === 0 && (
        <p class="health-error">Could not load activity data.</p>
      )}

      <div class={`health-content${isFetching && !isLoading ? ' is-refetching' : ''}`}>
        <ScoreSection series={series} start={start} end={end} />
        <StepsSection series={series} dates={dates} />
        <IntensitySection series={series} dates={dates} />
        <WorkoutsSection start={start} end={end} days={days} />
      </div>
    </div>
  )
}
