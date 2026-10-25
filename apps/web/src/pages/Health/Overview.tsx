import type {
  HealthDailyPoint,
  HealthOverviewData,
  HealthScoreSummary,
  HealthSignalSummary,
  HealthStressSummary,
} from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import {
  ActivitySummaryWidget,
  HrZonesWidget,
  LastSleepWidget,
  MetricCardWidget,
  WorkoutCalendarWidget,
} from '../../components/widgets'
import { fetchHealthOverview } from '../../state/api'
import '../Dashboard/style.css'
import {
  addDays,
  baselineDeltaTone,
  dayString,
  formatDelta,
  formatMetricValue,
  longDate,
  metricLabel,
} from './format'
import { HealthNav } from './HealthNav'
import {
  daySummaryChip,
  INSIGHT_SEVERITY,
  lastNightCaption,
  normalRangeText,
  resilienceText,
  type ScoreKind,
  scoreContext,
  signalChip,
  stressSplit,
  valueDateNote,
  WEARABLE_NOTE,
} from './overviewModel'
import { latestPoint, splitToday } from './series'
import { Sparkline } from './Sparkline'
import { StatusChip } from './StatusChip'
import { resilienceLevelOf } from './stressModel'
import { StressSplitBar } from './StressSplitBar'
import { useHealthDaily } from './useHealthDaily'
import './health.css'
import './overview.css'

const SCORE_CARDS: { href: string; kind: ScoreKind; label: string }[] = [
  { href: '/health/recovery', kind: 'readiness', label: 'Readiness' },
  { href: '/sleep', kind: 'sleep', label: 'Sleep' },
  { href: '/health/activity', kind: 'activity', label: 'Activity' },
]

/** Thirty days of history behind every stat on the page, in one request. */
const TREND_DAYS = 30

interface TrendTileSpec {
  metric: string
  href: string
  color?: string
  band?: boolean
  /** A daily total that accumulates during the day: today is shown apart, not compared. */
  accumulating?: boolean
}

const TREND_TILES: TrendTileSpec[] = [
  { href: '/sleep', metric: 'sleep_duration_sec' },
  { href: '/sleep', metric: 'sleep_efficiency_percent' },
  { accumulating: true, href: '/health/activity', metric: 'steps' },
  { accumulating: true, href: '/health/activity', metric: 'activity_calories_active' },
  { accumulating: true, color: 'var(--h-series-2)', href: '/health/stress', metric: 'stress_high_sec' },
  { accumulating: true, color: 'var(--h-series-3)', href: '/health/stress', metric: 'recovery_high_sec' },
  { band: false, href: '/health/stress', metric: 'resilience_score' },
  { href: '/sleep', metric: 'spo2' },
]

export const HOME_TREND_METRICS = [
  'readiness_score',
  'sleep_score',
  'activity_score',
  'hrv_sleep',
  'resting_heart_rate',
  'temperature_deviation',
  'respiratory_rate',
  ...TREND_TILES.map((t) => t.metric),
]

const SCORE_METRIC: Record<ScoreKind, string> = {
  activity: 'activity_score',
  readiness: 'readiness_score',
  sleep: 'sleep_score',
}

interface TrendRange {
  start: string
  end: string
  series: Map<string, HealthDailyPoint[]>
}

function TileSparkline({
  metric,
  range,
  height,
  color,
  band,
}: {
  metric: string
  range: TrendRange
  height: number
  color?: string
  band?: boolean
}) {
  return (
    <div class="overview-spark">
      <Sparkline
        metric={metric}
        points={range.series.get(metric) ?? []}
        start={range.start}
        end={range.end}
        height={height}
        color={color}
        band={band}
      />
      <div class="overview-spark-caption">Last {TREND_DAYS} days</div>
    </div>
  )
}

function ScoreCard({
  date,
  href,
  kind,
  label,
  summary,
  range,
}: {
  date: string
  href: string
  kind: ScoreKind
  label: string
  summary: HealthScoreSummary
  range: TrendRange
}) {
  const context = scoreContext(kind, summary)
  const dateNote = valueDateNote(summary.date, date)
  return (
    <a class="health-card overview-score" href={href}>
      <div class="health-tile-label">{label}</div>
      <div class="health-hero">{formatMetricValue(summary.metric, summary.value)}</div>
      {summary.value !== null && summary.delta !== null && (
        <div
          class={`health-delta health-delta-${baselineDeltaTone(summary.metric, summary.delta, summary.baseline)}`}
        >
          {formatDelta(summary.metric, summary.delta)} vs 30-day normal
        </div>
      )}
      <div class="health-tile-caption">
        {summary.value === null ? 'No data yet today' : context}
        {dateNote && <span> · {dateNote}</span>}
      </div>
      <TileSparkline metric={SCORE_METRIC[kind]} range={range} height={56} />
    </a>
  )
}

function SignalTile({
  date,
  signal,
  range,
}: {
  date: string
  signal: HealthSignalSummary
  range: TrendRange
}) {
  const chip = signalChip(signal)
  const caption = [normalRangeText(signal.metric, signal.baseline), valueDateNote(signal.date, date)]
    .filter(Boolean)
    .join(' · ')
  return (
    <a class="health-card health-tile health-tile-link" href={`/health/recovery#${signal.metric}`}>
      <div class="health-tile-label">{metricLabel(signal.metric)}</div>
      <div class="overview-tile-row">
        <div class="health-tile-value">{formatMetricValue(signal.metric, signal.value)}</div>
        <StatusChip {...chip} />
      </div>
      {caption && <div class="health-tile-caption">{caption}</div>}
      <TileSparkline metric={signal.metric} range={range} height={44} />
    </a>
  )
}

const trendValue = (metric: string, value: number | null): string => {
  if (metric === 'resilience_score' && value !== null) {
    const level = resilienceLevelOf(value)
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : '—'
  }
  return formatMetricValue(metric, value)
}

function TrendTile({ spec, range, date }: { spec: TrendTileSpec; range: TrendRange; date: string }) {
  const { complete, today } = splitToday(
    range.series.get(spec.metric) ?? [],
    date,
    spec.accumulating === true,
  )
  const latest = latestPoint(complete)
  const delta = latest?.baseline && spec.band !== false ? latest.value - latest.baseline.mean : null
  const dateNote = latest ? valueDateNote(latest.date, date) : null
  return (
    <a class="health-card health-tile health-tile-link" href={spec.href}>
      <div class="health-tile-label">{metricLabel(spec.metric)}</div>
      <div class="health-tile-value">{trendValue(spec.metric, latest?.value ?? null)}</div>
      <div class="health-tile-caption">
        {delta !== null && (
          <span
            class={`health-delta-inline health-delta-${baselineDeltaTone(spec.metric, delta, latest?.baseline)}`}
          >
            {formatDelta(spec.metric, delta)} vs normal
          </span>
        )}
        {delta !== null && dateNote && ' · '}
        {dateNote}
      </div>
      {today && (
        <div class="health-tile-caption">Today so far: {formatMetricValue(spec.metric, today.value)}</div>
      )}
      <TileSparkline
        metric={spec.metric}
        range={{
          ...range,
          end: spec.accumulating ? addDays(date, -1) : range.end,
          series: new Map([[spec.metric, complete]]),
        }}
        height={44}
        color={spec.color}
        band={spec.band}
      />
    </a>
  )
}

function StressCard({ date, stress }: { date: string; stress: HealthStressSummary }) {
  const split = stressSplit(stress)
  const dayChip = daySummaryChip(stress, date)
  const resilience = resilienceText(stress.resilience.level, stress.resilience.previous_level)
  return (
    <a class="health-card overview-stress" href="/health/stress">
      <div class="health-card-header">
        <h3>Stress &amp; resilience</h3>
        {stress.is_partial_day && split && <span class="health-muted">so far today</span>}
      </div>
      {split ? (
        <StressSplitBar stressSec={split.stressSec} restorativeSec={split.restorativeSec} />
      ) : (
        <div class="health-muted">No stress data yet today</div>
      )}
      <div class="overview-stress-chips">
        {dayChip && (
          <span>
            <span class="health-muted">Day: </span>
            <StatusChip {...dayChip} />
          </span>
        )}
        {resilience && (
          <span>
            <span class="health-muted">Resilience: </span>
            <span class="overview-resilience">{resilience}</span>
          </span>
        )}
      </div>
    </a>
  )
}

function Insights({ data }: { data: HealthOverviewData }) {
  if (data.insights.length === 0) {
    return (
      <p class="health-muted overview-calm">Nothing unusual — your signals are within your normal range.</p>
    )
  }
  return (
    <ul class="overview-insights">
      {data.insights.map((insight) => {
        const severity = INSIGHT_SEVERITY[insight.severity]
        return (
          <li key={insight.id} class="health-card overview-insight">
            <StatusChip tone={severity.tone} label={severity.label} />
            <div class="overview-insight-body">
              <div class="overview-insight-title">{insight.title}</div>
              <div class="health-muted">{insight.detail}</div>
              <a class="health-link" href={insight.href}>
                See details
              </a>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function OverviewBody({ data, range }: { data: HealthOverviewData; range: TrendRange }) {
  return (
    <>
      <section class="health-grid overview-scores">
        {SCORE_CARDS.map((card) => (
          <ScoreCard
            key={card.kind}
            {...card}
            date={data.date}
            summary={data.scores[card.kind]}
            range={range}
          />
        ))}
      </section>

      <section>
        <Insights data={data} />
      </section>

      <section>
        <h2>Last night &amp; recovery</h2>
        <div class="overview-night">
          <div class="dashboard overview-widgets">
            <LastSleepWidget config={{}} />
          </div>
          <div class="overview-signals">
            {data.signals.map((signal) => (
              <SignalTile key={signal.metric} date={data.date} signal={signal} range={range} />
            ))}
          </div>
        </div>
      </section>

      <section>
        <h2>Trends</h2>
        <div class="overview-trends">
          {TREND_TILES.map((spec) => (
            <TrendTile key={spec.metric} spec={spec} range={range} date={data.date} />
          ))}
        </div>
      </section>

      <section>
        <StressCard date={data.date} stress={data.stress} />
      </section>

      <section>
        <h2>Activity</h2>
        <div class="dashboard overview-widgets">
          <ActivitySummaryWidget config={{ lookback_days: 7 }} />
        </div>
        <div class="dashboard overview-widgets overview-activity">
          <WorkoutCalendarWidget config={{ lookback_days: 30 }} />
          <div class="overview-activity-side">
            <MetricCardWidget
              config={{
                metric: 'zone2_weekly',
                subtitle: 'Target: 150-200 min/week',
                title: 'Zone 2 (Weekly)',
                unit: 'min',
              }}
            />
            <HrZonesWidget config={{ lookback_days: 7, show_targets: true }} />
          </div>
        </div>
      </section>
    </>
  )
}

export function HealthOverview() {
  const query = useQuery({
    queryFn: () => fetchHealthOverview(),
    queryKey: ['healthOverview'],
    staleTime: 5 * 60 * 1000,
  })
  const data = query.data
  const end = dayString(new Date())
  const start = addDays(end, -(TREND_DAYS - 1))
  const daily = useHealthDaily(HOME_TREND_METRICS, start, end)
  const range: TrendRange = { end, series: daily.series, start }

  return (
    <div class="health-page overview">
      <HealthNav />
      <div class="health-header">
        <div>
          <h1>Today</h1>
          {data && (
            <div class="health-subtitle">
              {longDate(data.date)} · {lastNightCaption(data.last_sleep_date, data.date)}
            </div>
          )}
        </div>
      </div>

      {query.isLoading && <p class="health-muted">Loading your health overview…</p>}
      {query.isError && !data && <p class="health-error">Could not load your health overview.</p>}
      {data && (
        <div class={`health-content${query.isFetching ? ' is-refetching' : ''}`}>
          <OverviewBody data={data} range={range} />
        </div>
      )}

      <footer class="overview-footer">
        <p class="health-note">{WEARABLE_NOTE}</p>
        <a class="health-link" href="/dashboard">
          Customize your dashboard →
        </a>
      </footer>
    </div>
  )
}
