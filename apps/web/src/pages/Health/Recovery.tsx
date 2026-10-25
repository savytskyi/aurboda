import { readinessContributorMetrics } from '@aurboda/api-spec'

import { baselineDeltaTone, formatDelta, formatMetricValue, shortDate } from './format'
import { HealthNav } from './HealthNav'
import { MetricTrendCard, SERIES_COLORS, useHashScroll } from './MetricTrendCard'
import { normalRangeText } from './overviewModel'
import { RangeSelector, rangeOptions } from './RangeSelector'
import { ScoreBars } from './ScoreBars'
import { latestDate, latestDelta, latestPoint, rangeAverage, valueOn } from './series'
import { TrendChart } from './TrendChart'
import { useHealthDaily } from './useHealthDaily'
import { useRange } from './useRange'
import './health.css'

const SIGNAL_CARDS: { caption?: string; metric: string; zeroLine?: boolean }[] = [
  { metric: 'hrv_sleep' },
  { metric: 'resting_heart_rate' },
  { metric: 'sleep_average_heart_rate' },
  {
    caption: 'Oura measures this against its own baseline of your temperature',
    metric: 'temperature_deviation',
    zeroLine: true,
  },
  { metric: 'respiratory_rate' },
]

const METRICS = ['readiness_score', ...readinessContributorMetrics, ...SIGNAL_CARDS.map((c) => c.metric)]

export function Recovery() {
  const { days, end, setDays, start } = useRange(rangeOptions(true))
  const { error, isFetching, isLoading, isPlaceholderData, series } = useHealthDaily(METRICS, start, end)
  useHashScroll(!isLoading)

  const readiness = series.get('readiness_score') ?? []
  const latest = latestPoint(readiness)
  const delta = latestDelta(readiness)
  const contributorDate = latestDate(readinessContributorMetrics.map((m) => series.get(m)))

  return (
    <div class="health-page">
      <HealthNav />
      <div class="health-header">
        <h1>Recovery</h1>
        <RangeSelector value={days} onChange={setDays} includeYear />
      </div>

      {isLoading && <p class="health-muted">Loading recovery data…</p>}
      {error && !isPlaceholderData && series.size === 0 && (
        <p class="health-error">Could not load recovery data.</p>
      )}

      <div class={`health-content${isFetching && !isLoading ? ' is-refetching' : ''}`}>
        <section class="health-card">
          <div class="health-card-header">
            <div>
              <div class="health-tile-label">Readiness</div>
              <div class="health-hero">{formatMetricValue('readiness_score', latest?.value ?? null)}</div>
              {delta !== null && (
                <div
                  class={`health-delta health-delta-${baselineDeltaTone('readiness_score', delta, latest?.baseline)}`}
                >
                  {formatDelta('readiness_score', delta)} vs 30-day normal
                </div>
              )}
              <div class="health-tile-caption">
                {latest
                  ? [shortDate(latest.date), normalRangeText('readiness_score', latest.baseline)]
                      .filter(Boolean)
                      .join(' · ')
                  : 'No readiness score in this range'}
              </div>
            </div>
          </div>
          <TrendChart
            series={[
              { color: SERIES_COLORS[0], label: 'Readiness', metric: 'readiness_score', points: readiness },
            ]}
            start={start}
            end={end}
          />
        </section>

        <section class="health-card">
          <div class="health-card-header">
            <h2>Readiness contributors</h2>
            {contributorDate && <span class="health-muted">{shortDate(contributorDate)}</span>}
          </div>
          <ScoreBars
            items={readinessContributorMetrics.map((metric) => ({
              average: rangeAverage(series.get(metric)),
              metric,
              value: valueOn(series.get(metric), contributorDate),
            }))}
          />
        </section>

        <section>
          <h2>Overnight signals</h2>
          <div class="health-grid health-grid-wide">
            {SIGNAL_CARDS.map((card) => (
              <MetricTrendCard
                key={card.metric}
                anchor
                metric={card.metric}
                points={series.get(card.metric) ?? []}
                start={start}
                end={end}
                caption={card.caption}
                zeroLine={card.zeroLine}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
