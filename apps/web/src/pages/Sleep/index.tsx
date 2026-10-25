import type { HealthDailyPoint } from '@aurboda/api-spec'

import { sleepContributorMetrics } from '@aurboda/api-spec'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay } from 'date-fns'
import { useEffect, useRef } from 'preact/hooks'

import { fetchActivities, fetchSleepSchedule } from '../../state/api'
import { deltaTone, formatDelta, formatMetricValue, parseDay, shortDate } from '../Health/format'
import { HealthNav } from '../Health/HealthNav'
import { MetricTrendCard, SERIES_COLORS } from '../Health/MetricTrendCard'
import { RangeSelector, rangeOptions } from '../Health/RangeSelector'
import { ScoreBars } from '../Health/ScoreBars'
import { latestDate, latestDelta, latestPoint, rangeAverage, valueOn } from '../Health/series'
import { StageBar } from '../Health/StageBar'
import { StatTile } from '../Health/StatTile'
import { TrendChart } from '../Health/TrendChart'
import { useHealthDaily } from '../Health/useHealthDaily'
import { useRange } from '../Health/useRange'
import { getSleepScoreEmptyState, type SleepScoreEmptyState } from './emptyState'
import { recommendationLines, scheduleStatsText } from './schedule'
import { ScheduleChart } from './ScheduleChart'
import '../Health/health.css'
import './style.css'

const STAGE_METRICS = {
  awake: 'sleep_awake_sec',
  deep: 'sleep_deep_sec',
  light: 'sleep_light_sec',
  rem: 'sleep_rem_sec',
} as const

const STAT_METRICS = [
  { caption: 'Overall sleep quality', label: 'Sleep score', metric: 'sleep_score' },
  { caption: 'Time actually asleep', label: 'Total sleep', metric: 'sleep_duration_sec' },
  { caption: 'Time asleep vs. in bed', label: 'Efficiency', metric: 'sleep_efficiency_percent' },
  { caption: 'Lower is better', label: 'Time to fall asleep', metric: 'sleep_latency_sec' },
  { caption: 'From lying down to getting up', label: 'Time in bed', metric: 'time_in_bed_sec' },
] as const

const BREATHING = [
  { metric: 'spo2' },
  { metric: 'respiratory_rate' },
  {
    caption: 'Lower is better; Oura counts breathing irregularities per hour',
    metric: 'breathing_disturbance_index',
  },
] as const

const METRICS = [
  ...STAT_METRICS.map((s) => s.metric),
  ...Object.values(STAGE_METRICS),
  ...sleepContributorMetrics,
  ...BREATHING.map((b) => b.metric),
  'resting_heart_rate',
  'sleep_average_heart_rate',
]

export interface DurationNight {
  date: string
  hours: number
}

export const durationNights = (points: readonly HealthDailyPoint[]): DurationNight[] =>
  points.map((p) => ({ date: p.date, hours: p.value / 3600 }))

function SleepDurationChart({ nights, height = 180 }: { nights: DurationNight[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nights.length < 2) return

    const containerWidth = containerRef.current.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 45, right: 20, top: 20 }
    const width = containerWidth
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const x = d3
      .scaleBand()
      .domain(nights.map((d) => d.date))
      .range([0, innerWidth])
      .padding(0.2)

    const yMax = Math.max(10, d3.max(nights, (d) => d.hours) ?? 10)
    const y = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0])

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    g.append('rect')
      .attr('x', 0)
      .attr('y', y(9))
      .attr('width', innerWidth)
      .attr('height', y(7) - y(9))
      .style('fill', 'var(--h-dur-good)')
      .attr('fill-opacity', 0.1)

    const barWidth = Math.min(24, x.bandwidth())
    g.selectAll('.bar')
      .data(nights)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => (x(d.date) ?? 0) + (x.bandwidth() - barWidth) / 2)
      .attr('y', (d) => y(d.hours))
      .attr('width', barWidth)
      .attr('height', (d) => innerHeight - y(d.hours))
      .style('fill', (d) =>
        d.hours >= 7 && d.hours <= 9
          ? 'var(--h-dur-good)'
          : d.hours < 6
            ? 'var(--h-dur-bad)'
            : 'var(--h-dur-warn)',
      )
      .attr('rx', 2)
      .append('title')
      .text((d) => `${shortDate(d.date)}: ${formatMetricValue('sleep_duration_sec', d.hours * 3600)}`)

    const avgDuration = d3.mean(nights, (d) => d.hours) ?? 0
    g.append('line')
      .attr('x1', 0)
      .attr('y1', y(avgDuration))
      .attr('x2', innerWidth)
      .attr('y2', y(avgDuration))
      .style('stroke', 'var(--h-dur-avg)')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')

    g.append('text')
      .attr('x', innerWidth - 5)
      .attr('y', y(avgDuration) - 5)
      .attr('text-anchor', 'end')
      .style('fill', 'var(--h-dur-avg)')
      .attr('font-size', '11px')
      .text(`Avg: ${avgDuration.toFixed(1)}h`)

    const tickValues = nights.filter((_, i) => i % Math.ceil(nights.length / 8) === 0).map((d) => d.date)

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickValues)
          .tickFormat((d) => d3.timeFormat('%b %d')(parseDay(d))),
      )
      .selectAll('text')
      .attr('fill', 'currentColor')

    g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('fill', 'currentColor')

    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -35)
      .attr('x', -innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', '12px')
      .text('Hours')
  }, [nights, height])

  if (nights.length < 2) {
    return <div class="chart-placeholder">Not enough sleep data to display chart</div>
  }

  return (
    <div ref={containerRef} class="chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

function SleepScheduleSection({ start, end }: { start: string; end: string }) {
  const query = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchSleepSchedule(start, end),
    queryKey: ['sleepSchedule', start, end],
    staleTime: 5 * 60 * 1000,
  })
  const data = query.data
  const stats = data ? scheduleStatsText(data.stats) : null
  const lines = recommendationLines(data?.recommendation ?? null)
  return (
    <section class={`health-card${query.isFetching && !query.isLoading ? ' is-refetching' : ''}`}>
      <div class="health-card-header">
        <h2>Schedule</h2>
        {stats && <span class="health-muted">{stats}</span>}
      </div>
      {query.isLoading && <p class="health-muted">Loading schedule…</p>}
      {query.isError && !data && <p class="health-error">Could not load your sleep schedule.</p>}
      {data && <ScheduleChart data={data} start={start} end={end} />}
      {lines.length > 0 && (
        <ul class="sleep-recommendation">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

type SeriesMap = Map<string, HealthDailyPoint[]>

function SleepStatTiles({ series }: { series: SeriesMap }) {
  const durationPoints = series.get('sleep_duration_sec') ?? []
  return (
    <section>
      <div class="health-grid">
        {STAT_METRICS.map(({ caption, label, metric }) => {
          const points = series.get(metric)
          const delta = latestDelta(points)
          return (
            <StatTile
              key={metric}
              label={label}
              value={formatMetricValue(metric, rangeAverage(points))}
              caption={`${caption} · average per night`}
              delta={
                delta === null
                  ? undefined
                  : {
                      text: `Latest night ${formatDelta(metric, delta)} vs your 30-day normal`,
                      tone: deltaTone(metric, delta),
                    }
              }
            />
          )
        })}
      </div>
      <p class="health-muted sleep-nights">
        Based on <strong>{durationPoints.length}</strong> nights with a sleep total in this range.
      </p>
    </section>
  )
}

function SleepStagesSection({ series }: { series: SeriesMap }) {
  const stageLatestDate = latestDate(Object.values(STAGE_METRICS).map((m) => series.get(m)))
  const latestStages = {
    awake: valueOn(series.get(STAGE_METRICS.awake), stageLatestDate),
    deep: valueOn(series.get(STAGE_METRICS.deep), stageLatestDate),
    light: valueOn(series.get(STAGE_METRICS.light), stageLatestDate),
    rem: valueOn(series.get(STAGE_METRICS.rem), stageLatestDate),
  }
  const averageStages = {
    awake: rangeAverage(series.get(STAGE_METRICS.awake)),
    deep: rangeAverage(series.get(STAGE_METRICS.deep)),
    light: rangeAverage(series.get(STAGE_METRICS.light)),
    rem: rangeAverage(series.get(STAGE_METRICS.rem)),
  }
  return (
    <section class="health-card">
      <h2>Last night</h2>
      <StageBar
        label={stageLatestDate ? `Woke ${shortDate(stageLatestDate)}` : 'Last night'}
        stages={latestStages}
      />
      <StageBar label="Average" stages={averageStages} />
    </section>
  )
}

function SleepScoreSection({
  points,
  emptyState,
  start,
  end,
}: {
  points: HealthDailyPoint[]
  emptyState: SleepScoreEmptyState | null
  start: string
  end: string
}) {
  const latest = latestPoint(points)
  return (
    <section class="health-card">
      <div class="health-card-header">
        <h2>Sleep score</h2>
        {latest && <span class="health-card-value">{formatMetricValue('sleep_score', latest.value)}</span>}
      </div>
      {emptyState ? (
        <div class="chart-placeholder">
          {emptyState.message}
          {emptyState.linkHref && (
            <>
              {' '}
              <a href={emptyState.linkHref}>{emptyState.linkLabel}</a>.
            </>
          )}
        </div>
      ) : (
        <TrendChart
          series={[{ color: SERIES_COLORS[0], label: 'Sleep score', metric: 'sleep_score', points }]}
          start={start}
          end={end}
        />
      )}
    </section>
  )
}

export function Sleep() {
  const { days, end, setDays, start } = useRange(rangeOptions(true))
  const { error, isFetching, isLoading, series } = useHealthDaily(METRICS, start, end)

  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(parseDay(start), endOfDay(parseDay(end)), ['sleep']),
    queryKey: ['sleepActivities', start, end],
    staleTime: 5 * 60 * 1000,
  })

  const scorePoints = series.get('sleep_score') ?? []
  const durationPoints = series.get('sleep_duration_sec') ?? []
  const hasSleepSessions = durationPoints.length > 0 || (activitiesQuery.data?.length ?? 0) > 0
  const contributorDate = latestDate(sleepContributorMetrics.map((m) => series.get(m)))

  return (
    <div class="health-page sleep-page">
      <HealthNav />
      <div class="health-header">
        <h1>Sleep</h1>
        <RangeSelector value={days} onChange={setDays} includeYear />
      </div>

      {isLoading && <p class="health-muted">Loading sleep data…</p>}
      {error && series.size === 0 && <p class="health-error">Could not load sleep data.</p>}

      <div class={`health-content${isFetching && !isLoading ? ' is-refetching' : ''}`}>
        <SleepStatTiles series={series} />
        <SleepStagesSection series={series} />
        <SleepScoreSection
          points={scorePoints}
          emptyState={getSleepScoreEmptyState(scorePoints.length, hasSleepSessions)}
          start={start}
          end={end}
        />
        <section class="health-card">
          <h2>Sleep duration</h2>
          <div class="duration-legend">
            <span class="legend-item">
              <span class="legend-color green" /> 7-9 hours (optimal)
            </span>
            <span class="legend-item">
              <span class="legend-color yellow" /> 6-7 or 9+ hours
            </span>
            <span class="legend-item">
              <span class="legend-color red" /> &lt;6 hours
            </span>
          </div>
          <SleepDurationChart nights={durationNights(durationPoints)} />
        </section>

        <section class="health-card">
          <div class="health-card-header">
            <h2>Sleep score contributors</h2>
            {contributorDate && (
              <span class="health-muted">Scores out of 100 · {shortDate(contributorDate)}</span>
            )}
          </div>
          <ScoreBars
            items={sleepContributorMetrics.map((metric) => ({
              average: rangeAverage(series.get(metric)),
              metric,
              value: valueOn(series.get(metric), contributorDate),
            }))}
          />
        </section>

        <SleepScheduleSection start={start} end={end} />

        <section>
          <h2>Breathing</h2>
          <div class="health-grid health-grid-wide">
            {BREATHING.map((b) => (
              <MetricTrendCard
                key={b.metric}
                metric={b.metric}
                points={series.get(b.metric) ?? []}
                start={start}
                end={end}
                height={150}
                caption={'caption' in b ? b.caption : undefined}
              />
            ))}
          </div>
        </section>

        <section class="health-card">
          <h2>Nighttime heart rate</h2>
          <TrendChart
            series={[
              {
                color: SERIES_COLORS[0],
                label: 'Resting HR (lowest overnight)',
                metric: 'resting_heart_rate',
                points: series.get('resting_heart_rate') ?? [],
              },
              {
                color: SERIES_COLORS[1],
                label: 'Average overnight HR',
                metric: 'sleep_average_heart_rate',
                points: series.get('sleep_average_heart_rate') ?? [],
              },
            ]}
            start={start}
            end={end}
          />
        </section>
      </div>
    </div>
  )
}
