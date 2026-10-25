import type { HealthOverviewData, HealthScoreSummary, HealthStressSummary } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchHealthOverview } from '../../state/api'
import { baselineDeltaTone, formatDelta, formatMetricValue, longDate, metricLabel } from './format'
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
import { StatTile } from './StatTile'
import { StatusChip } from './StatusChip'
import { StressSplitBar } from './StressSplitBar'
import './health.css'
import './overview.css'

const SCORE_CARDS: { href: string; kind: ScoreKind; label: string }[] = [
  { href: '/health/recovery', kind: 'readiness', label: 'Readiness' },
  { href: '/sleep', kind: 'sleep', label: 'Sleep' },
  { href: '/health/activity', kind: 'activity', label: 'Activity' },
]

function ScoreCard({
  date,
  href,
  kind,
  label,
  summary,
}: {
  date: string
  href: string
  kind: ScoreKind
  label: string
  summary: HealthScoreSummary
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

function OverviewBody({ data }: { data: HealthOverviewData }) {
  return (
    <>
      <section class="health-grid overview-scores">
        {SCORE_CARDS.map((card) => (
          <ScoreCard key={card.kind} {...card} date={data.date} summary={data.scores[card.kind]} />
        ))}
      </section>

      <section>
        <h2>Recovery signals</h2>
        <div class="health-grid">
          {data.signals.map((signal) => (
            <StatTile
              key={signal.metric}
              href={`/health/recovery#${signal.metric}`}
              label={metricLabel(signal.metric)}
              value={formatMetricValue(signal.metric, signal.value)}
              caption={
                [normalRangeText(signal.metric, signal.baseline), valueDateNote(signal.date, data.date)]
                  .filter(Boolean)
                  .join(' · ') || undefined
              }
              status={signalChip(signal)}
            />
          ))}
        </div>
      </section>

      <section>
        <StressCard date={data.date} stress={data.stress} />
      </section>

      <section>
        <h2>Insights</h2>
        {data.insights.length === 0 ? (
          <p class="health-muted">Nothing unusual — your signals are within your normal range.</p>
        ) : (
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
        )}
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
          <OverviewBody data={data} />
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
