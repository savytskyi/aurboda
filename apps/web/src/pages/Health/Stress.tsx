import type { HealthDailyPoint, StressDaySummary } from '@aurboda/api-spec'

import { useMemo, useState } from 'preact/hooks'

import { DailyBarChart, type DailyBarSeries } from './DailyBarChart'
import { weeksCovering } from './dailyBarUtils'
import { axisTickLabel, formatDuration, metricLabel, shortDate } from './format'
import { HealthNav } from './HealthNav'
import { SERIES_COLORS } from './MetricTrendCard'
import { DAY_SUMMARY } from './overviewModel'
import { RangeSelector, RANGE_OPTIONS } from './RangeSelector'
import { ResilienceLevelChart } from './ResilienceLevelChart'
import { ScoreBars } from './ScoreBars'
import { latestDate, latestPoint, valueOn } from './series'
import { StatTile } from './StatTile'
import { StatusChip } from './StatusChip'
import {
  type BalanceView,
  balanceValues,
  daySummaryCounts,
  daySummaryOf,
  resilienceChip,
  resilienceLevelOf,
} from './stressModel'
import { RESTORE_COLOR, STRESS_COLOR, StressSplitBar } from './StressSplitBar'
import { TrendChart } from './TrendChart'
import { daysBetween } from './trendChartUtils'
import { useHealthDaily } from './useHealthDaily'
import { rangeDates, useRange } from './useRange'
import './health.css'

const RANGE_METRICS = ['stress_high_sec', 'recovery_high_sec', 'stress_day_summary']
const RESILIENCE_CONTRIBUTORS = [
  'resilience_sleep_recovery',
  'resilience_daytime_recovery',
  'resilience_stress',
] as const
const RESILIENCE_METRICS = ['resilience_score', ...RESILIENCE_CONTRIBUTORS]
const SUMMARY_ORDER: StressDaySummary[] = ['restored', 'normal', 'stressful']
const SUMMARY_LETTER: Record<StressDaySummary, string> = { normal: 'N', restored: 'R', stressful: 'S' }

type SeriesMap = Map<string, HealthDailyPoint[]>

function LatestDay({ series, today }: { series: SeriesMap; today: string }) {
  const date = latestDate([series.get('stress_high_sec'), series.get('recovery_high_sec')])
  const summaryPoint = latestPoint(series.get('stress_day_summary'))
  const summary = summaryPoint ? daySummaryOf(summaryPoint.value) : null
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>{date === today ? 'Today so far' : date ? shortDate(date) : 'Latest day'}</h2>
        {summary && summaryPoint && (
          <span>
            <span class="health-muted">Day summary ({shortDate(summaryPoint.date)}): </span>
            <StatusChip {...DAY_SUMMARY[summary]} />
          </span>
        )}
      </div>
      {date ? (
        <StressSplitBar
          stressSec={valueOn(series.get('stress_high_sec'), date)}
          restorativeSec={valueOn(series.get('recovery_high_sec'), date)}
        />
      ) : (
        <p class="health-muted">No stress data in this range.</p>
      )}
    </section>
  )
}

function BalanceSection({ series, start, end }: { series: SeriesMap; start: string; end: string }) {
  const [view, setView] = useState<BalanceView>('daily')
  const dates = useMemo(
    () => (view === 'weekly' ? weeksCovering(start, end) : daysBetween(start, end)),
    [view, start, end],
  )
  const bars = useMemo<DailyBarSeries[]>(
    () => [
      {
        color: STRESS_COLOR,
        key: 'stress',
        label: 'High stress',
        values: balanceValues(series.get('stress_high_sec') ?? [], view),
      },
      {
        color: RESTORE_COLOR,
        direction: 'down',
        key: 'restore',
        label: 'Restorative',
        values: balanceValues(series.get('recovery_high_sec') ?? [], view),
      },
    ],
    [series, view],
  )
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>Daily balance</h2>
        <div class="health-range" role="group" aria-label="Aggregation">
          {(['daily', 'weekly'] as const).map((v) => (
            <button
              key={v}
              type="button"
              class="health-range-option"
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>
      <DailyBarChart
        dates={dates}
        series={bars}
        formatValue={formatDuration}
        formatTick={(v) => axisTickLabel('stress_high_sec', Math.abs(v))}
        tickUnit={3600}
        bucketLabel={view === 'weekly' ? (d) => `Week of ${shortDate(d)}` : undefined}
        ariaLabel={`${view === 'weekly' ? 'Weekly' : 'Daily'} high-stress time above the line and restorative time below it.`}
      />
      <div class="health-caption">High stress above the line, restorative time below it.</div>
    </section>
  )
}

function DaySummarySection({
  points,
  start,
  end,
}: {
  points: HealthDailyPoint[]
  start: string
  end: string
}) {
  const counts = daySummaryCounts(points)
  const byDate = new Map(points.map((p) => [p.date, daySummaryOf(p.value)]))
  const days = daysBetween(start, end)
  return (
    <section>
      <h2>Day summaries</h2>
      <div class="health-grid">
        {SUMMARY_ORDER.map((s) => (
          <StatTile
            key={s}
            label={`${DAY_SUMMARY[s].label} days`}
            value={String(counts[s])}
            status={{ ...DAY_SUMMARY[s], label: `${SUMMARY_LETTER[s]} · ${DAY_SUMMARY[s].label}` }}
          />
        ))}
      </div>
      {points.length === 0 ? (
        <p class="health-muted">No day summaries in this range.</p>
      ) : (
        <ul class="health-day-strip" aria-label="Day summary per day">
          {days.map((day) => {
            const summary = byDate.get(day) ?? null
            const text = `${shortDate(day)}: ${summary ? DAY_SUMMARY[summary].label : 'no summary'}`
            return (
              <li
                key={day}
                class={`health-day-dot health-day-${summary ?? 'none'}`}
                title={text}
                aria-label={text}
              >
                {summary ? SUMMARY_LETTER[summary] : ''}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ResilienceSection({ series, start, end }: { series: SeriesMap; start: string; end: string }) {
  const scores = series.get('resilience_score') ?? []
  const latest = latestPoint(scores)
  const level = latest ? resilienceLevelOf(latest.value) : null
  const contributorDate = latestDate(RESILIENCE_CONTRIBUTORS.map((m) => series.get(m)))
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>Resilience</h2>
        {level && latest ? (
          <span>
            <StatusChip {...resilienceChip(level)} />
            <span class="health-muted"> · {shortDate(latest.date)}</span>
          </span>
        ) : (
          <span class="health-muted">No resilience level yet</span>
        )}
      </div>
      {contributorDate && (
        <ScoreBars
          attentionBelow={null}
          items={RESILIENCE_CONTRIBUTORS.map((metric) => ({
            metric,
            value: valueOn(series.get(metric), contributorDate),
          }))}
        />
      )}
      <h3 class="health-subheading">Level over the last year</h3>
      <ResilienceLevelChart points={scores} start={start} end={end} />
      <h3 class="health-subheading">Contributors over the last year</h3>
      <TrendChart
        series={RESILIENCE_CONTRIBUTORS.map((metric, i) => ({
          color: SERIES_COLORS[i] ?? SERIES_COLORS[0],
          label: metricLabel(metric),
          metric,
          points: series.get(metric) ?? [],
        }))}
        band={false}
        start={start}
        end={end}
      />
      <div class="health-caption">Contributor scores run from 0 to 100; higher is better.</div>
    </section>
  )
}

export function HealthStress() {
  const { days, end, setDays, start } = useRange(RANGE_OPTIONS)
  const range = useHealthDaily(RANGE_METRICS, start, end)
  const year = rangeDates(365)
  const resilience = useHealthDaily(RESILIENCE_METRICS, year.start, year.end)
  const loading = range.isLoading || resilience.isLoading

  return (
    <div class="health-page">
      <HealthNav />
      <div class="health-header">
        <h1>Stress &amp; Resilience</h1>
        <RangeSelector value={days} onChange={setDays} />
      </div>

      {loading && <p class="health-muted">Loading stress data…</p>}
      {range.error && range.series.size === 0 && <p class="health-error">Could not load stress data.</p>}

      <div class={`health-content${range.isFetching && !range.isLoading ? ' is-refetching' : ''}`}>
        <LatestDay series={range.series} today={end} />
        <BalanceSection series={range.series} start={start} end={end} />
        <DaySummarySection points={range.series.get('stress_day_summary') ?? []} start={start} end={end} />
      </div>
      <ResilienceSection series={resilience.series} start={year.start} end={year.end} />
    </div>
  )
}
