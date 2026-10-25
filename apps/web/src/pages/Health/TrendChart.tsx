import type { HealthDailyPoint } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { useMemo } from 'preact/hooks'

import {
  AXIS_TEXT_COLOR,
  CHART_MARGIN,
  ChartEmpty,
  chartFocusProps,
  ChartTooltip,
  pointerIndex,
  useChartCursor,
  XAxisLabels,
  YGrid,
} from './chartParts'
import {
  axisTickLabel,
  formatMetricRange,
  formatMetricValue,
  normalBounds,
  parseDay,
  shortDate,
} from './format'
import {
  type BandPoint,
  bandSegments,
  daysBetween,
  paddedDomain,
  rollingMean,
  timeTickFormat,
  timeTicks,
} from './trendChartUtils'
import { useContainerWidth } from './useContainerWidth'
import './health.css'

export interface TrendSeries {
  metric: string
  label: string
  color: string
  points: HealthDailyPoint[]
}

export interface TrendChartProps {
  series: TrendSeries[]
  /** Personal-normal band (mean ± 1 sd). Defaults to on for exactly one series. */
  band?: boolean
  start: string
  end: string
  height?: number
  zeroLine?: boolean
  referenceLine?: { value: number; label: string }
  /** Draws a 7-day rolling mean as the line, with the daily values as faint dots. */
  smooth?: boolean
}

const BAND_FILL = 'var(--h-band-fill)'
const BAND_MEAN = 'var(--h-band-mean)'
const DOT_RING = 'var(--h-dot-ring)'

type Lookup = Map<string, HealthDailyPoint>

interface Scales {
  x: (day: string) => number
  y: (value: number) => number
  innerWidth: number
  innerHeight: number
}

const buildModel = (
  series: TrendSeries[],
  start: string,
  end: string,
  showBand: boolean,
  extra: number[],
  smooth: boolean,
) => {
  const days = daysBetween(start, end)
  const byDate: Lookup[] = series.map((s) => new Map(s.points.map((p) => [p.date, p])))
  const lines: TrendSeries[] = smooth ? series.map((s) => ({ ...s, points: rollingMean(s.points) })) : series
  const lineByDate: Lookup[] = smooth ? lines.map((s) => new Map(s.points.map((p) => [p.date, p]))) : byDate
  const segments = showBand ? series.map((s) => bandSegments(s.points, s.metric)) : []
  const values = [
    ...series.flatMap((s) => s.points.map((p) => p.value)),
    ...segments.flat(2).flatMap((b) => [b.lo, b.hi]),
    ...extra,
  ]
  const hoverDates = days.filter((day) => byDate.some((m) => m.has(day)))
  return { byDate, days, domain: paddedDomain(values), hoverDates, lineByDate, lines, segments }
}

const describeSeries = (series: TrendSeries[], start: string, end: string): string => {
  const parts = series.map((s) => {
    const latest = s.points.at(-1)
    return latest
      ? `${s.label}, latest ${formatMetricValue(s.metric, latest.value)} on ${shortDate(latest.date)}`
      : `${s.label}, no data`
  })
  return `${parts.join('; ')}. ${shortDate(start)} to ${shortDate(end)}. Use arrow keys to read values.`
}

function Legend({ series, showBand, smooth }: { series: TrendSeries[]; showBand: boolean; smooth: boolean }) {
  if (series.length < 2 && !smooth) return null
  return (
    <div class="health-legend">
      {smooth && series.length === 1 && (
        <span class="health-legend-item">
          <span class="health-line-key" style={{ background: series[0]?.color }} />
          7-day average
        </span>
      )}
      {smooth && (
        <span class="health-legend-item">
          <span class="health-dot-key" style={{ background: series[0]?.color }} />
          daily values
        </span>
      )}
      {series.length >= 2 &&
        series.map((s) => (
          <span key={s.metric} class="health-legend-item">
            <span class="health-line-key" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      {showBand && (
        <span class="health-legend-item">
          <span class="health-band-key" />
          30-day normal
        </span>
      )}
    </div>
  )
}

function Band({ segments, scales }: { segments: BandPoint[][]; scales: Scales }) {
  const area = d3
    .area<BandPoint>()
    .x((d) => scales.x(d.date))
    .y0((d) => scales.y(d.lo))
    .y1((d) => scales.y(d.hi))
    .curve(d3.curveLinear)
  const mean = d3
    .line<BandPoint>()
    .x((d) => scales.x(d.date))
    .y((d) => scales.y(d.mean))
    .curve(d3.curveLinear)
  return (
    <>
      {segments.map((seg) => (
        <g key={seg[0]?.date}>
          <path d={area(seg) ?? ''} style={{ fill: BAND_FILL, fillOpacity: 'var(--h-band-opacity)' }} />
          <path d={mean(seg) ?? ''} fill="none" style={{ stroke: BAND_MEAN }} stroke-width={1} />
        </g>
      ))}
    </>
  )
}

function SeriesLine({
  series,
  rows,
  scales,
}: {
  series: TrendSeries
  rows: (HealthDailyPoint | null)[]
  scales: Scales
}) {
  const line = d3
    .line<HealthDailyPoint | null>()
    .defined((d) => d !== null)
    .x((d) => scales.x(d?.date ?? ''))
    .y((d) => scales.y(d?.value ?? 0))
    .curve(d3.curveLinear)
  const isolated = rows.filter((r, i): r is HealthDailyPoint => r !== null && !rows[i - 1] && !rows[i + 1])
  const latest = series.points.at(-1)
  return (
    <g>
      <path
        d={line(rows) ?? ''}
        fill="none"
        style={{ stroke: series.color }}
        stroke-width={2}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      {isolated.map((r) => (
        <circle
          key={r.date}
          cx={scales.x(r.date)}
          cy={scales.y(r.value)}
          r={2.5}
          style={{ fill: series.color }}
        />
      ))}
      {latest && (
        <circle
          cx={scales.x(latest.date)}
          cy={scales.y(latest.value)}
          r={4}
          style={{ fill: series.color, stroke: DOT_RING }}
          stroke-width={2}
        />
      )}
    </g>
  )
}

function RawDots({ series, scales }: { series: TrendSeries; scales: Scales }) {
  return (
    <g style={{ fill: series.color }} fill-opacity={0.35}>
      {series.points.map((p) => (
        <circle key={p.date} cx={scales.x(p.date)} cy={scales.y(p.value)} r={1.5} />
      ))}
    </g>
  )
}

function Crosshair({
  day,
  series,
  byDate,
  scales,
}: {
  day: string
  series: TrendSeries[]
  byDate: Lookup[]
  scales: Scales
}) {
  const cx = scales.x(day)
  return (
    <g pointer-events="none">
      <line
        x1={cx}
        x2={cx}
        y1={0}
        y2={scales.innerHeight}
        style={{ stroke: AXIS_TEXT_COLOR }}
        stroke-width={1}
      />
      {series.map((s, si) => {
        const p = byDate[si]?.get(day)
        return p ? (
          <circle
            key={s.metric}
            cx={cx}
            cy={scales.y(p.value)}
            r={4}
            style={{ fill: s.color, stroke: DOT_RING }}
            stroke-width={2}
          />
        ) : null
      })}
    </g>
  )
}

function TooltipRows({
  day,
  series,
  byDate,
  lineByDate,
  showBand,
  smooth,
}: {
  day: string
  series: TrendSeries[]
  byDate: Lookup[]
  lineByDate: Lookup[]
  showBand: boolean
  smooth: boolean
}) {
  return (
    <>
      <div class="health-tooltip-date">{shortDate(day)}</div>
      {series.map((s, si) => {
        const p = byDate[si]?.get(day)
        const baseline = showBand ? p?.baseline : null
        return (
          <div key={s.metric} class="health-tooltip-row">
            <span class="health-line-key" style={{ background: s.color }} />
            <strong>{formatMetricValue(s.metric, p?.value ?? null)}</strong>
            <span class="health-tooltip-label">{s.label}</span>
            {smooth && lineByDate[si]?.get(day) && (
              <span class="health-tooltip-normal">
                7-day avg {formatMetricValue(s.metric, lineByDate[si]?.get(day)?.value ?? null)}
              </span>
            )}
            {baseline && (
              <span class="health-tooltip-normal">
                normal{' '}
                {formatMetricRange(
                  s.metric,
                  normalBounds(s.metric, baseline).lo,
                  normalBounds(s.metric, baseline).hi,
                )}
              </span>
            )}
          </div>
        )
      })}
    </>
  )
}

function ReferenceLine({ line, scales }: { line: { value: number; label: string }; scales: Scales }) {
  const y = scales.y(line.value)
  return (
    <g>
      <line x1={0} x2={scales.innerWidth} y1={y} y2={y} style={{ stroke: AXIS_TEXT_COLOR }} />
      <text
        x={scales.innerWidth}
        y={y - 4}
        text-anchor="end"
        style={{ fill: AXIS_TEXT_COLOR }}
        font-size="11"
      >
        {line.label}
      </text>
    </g>
  )
}

type Model = ReturnType<typeof buildModel>

function TrendPlot({
  model,
  series,
  scales,
  xScale,
  yScale,
  width,
  height,
  zeroLine,
  referenceLine,
  hoverDay,
  smooth,
  onPointerMove,
  onPointerLeave,
}: {
  smooth: boolean
  model: Model
  series: TrendSeries[]
  scales: Scales
  xScale: d3.ScaleTime<number, number>
  yScale: d3.ScaleLinear<number, number>
  width: number
  height: number
  zeroLine: boolean
  referenceLine?: { value: number; label: string }
  hoverDay: string | null
  onPointerMove: (event: PointerEvent) => void
  onPointerLeave: () => void
}) {
  const axisMetric = series[0]?.metric ?? ''
  const { innerHeight, innerWidth } = scales
  return (
    <svg width={width} height={height} aria-hidden="true">
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
        <YGrid
          ticks={yScale.ticks(4)}
          yOf={yScale}
          width={innerWidth}
          label={(v) => axisTickLabel(axisMetric, v)}
        />
        <XAxisLabels
          ticks={timeTicks(xScale, model.days.length, innerWidth)}
          xOf={xScale}
          y={innerHeight}
          format={timeTickFormat(model.days.length)}
        />
        {model.segments.map((segs, si) => (
          <Band key={series[si]?.metric} segments={segs} scales={scales} />
        ))}
        {zeroLine && (
          <line x1={0} x2={innerWidth} y1={yScale(0)} y2={yScale(0)} style={{ stroke: AXIS_TEXT_COLOR }} />
        )}
        {referenceLine && <ReferenceLine line={referenceLine} scales={scales} />}
        {smooth && series.map((s) => <RawDots key={s.metric} series={s} scales={scales} />)}
        {model.lines.map((s, si) => (
          <SeriesLine
            key={s.metric}
            series={s}
            rows={model.days.map((day) => model.lineByDate[si]?.get(day) ?? null)}
            scales={scales}
          />
        ))}
        {hoverDay !== null && (
          <Crosshair day={hoverDay} series={series} byDate={model.byDate} scales={scales} />
        )}
        <rect
          width={innerWidth}
          height={innerHeight}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </g>
    </svg>
  )
}

export function TrendChart({
  series,
  band,
  start,
  end,
  height = 200,
  zeroLine = false,
  referenceLine,
  smooth = false,
}: TrendChartProps) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>()
  const showBand = band ?? series.length === 1
  const enough = series.reduce((n, s) => n + s.points.length, 0) >= 2

  const model = useMemo(() => {
    const extra = [zeroLine ? 0 : null, referenceLine?.value ?? null].filter((v) => v !== null)
    return buildModel(series, start, end, showBand, extra, smooth)
  }, [series, start, end, showBand, zeroLine, referenceLine, smooth])
  const cursor = useChartCursor(model.hoverDates.length)

  const innerWidth = Math.max(0, width - CHART_MARGIN.left - CHART_MARGIN.right)
  const innerHeight = height - CHART_MARGIN.top - CHART_MARGIN.bottom
  const xScale = d3
    .scaleTime()
    .domain([parseDay(start), parseDay(end)])
    .range([0, innerWidth])
  const yScale = d3
    .scaleLinear()
    .domain(model.domain ?? [0, 1])
    .nice(4)
    .range([innerHeight, 0])
  const scales: Scales = { innerHeight, innerWidth, x: (day) => xScale(parseDay(day)), y: yScale }
  const hoverDay = cursor.index === null ? null : (model.hoverDates[cursor.index] ?? null)

  const onPointerMove = (event: PointerEvent) =>
    cursor.setIndex(pointerIndex(event, model.hoverDates.map(scales.x)))

  return (
    <div class="health-chart">
      <Legend series={series} showBand={showBand} smooth={smooth} />
      <div
        ref={containerRef}
        class="health-chart-frame"
        style={{ minHeight: `${height}px` }}
        {...chartFocusProps(enough, describeSeries(series, start, end))}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.clear}
      >
        {!enough && <ChartEmpty height={height} message="Not enough data in this range yet." />}
        {enough && width > 0 && (
          <TrendPlot
            model={model}
            series={series}
            scales={scales}
            xScale={xScale}
            yScale={yScale}
            width={width}
            height={height}
            zeroLine={zeroLine}
            referenceLine={referenceLine}
            hoverDay={hoverDay}
            smooth={smooth}
            onPointerMove={onPointerMove}
            onPointerLeave={cursor.clear}
          />
        )}
        {hoverDay !== null && (
          <ChartTooltip anchorX={scales.x(hoverDay) + CHART_MARGIN.left} containerWidth={width}>
            <TooltipRows
              day={hoverDay}
              series={series}
              byDate={model.byDate}
              lineByDate={model.lineByDate}
              showBand={showBand}
              smooth={smooth}
            />
          </ChartTooltip>
        )}
      </div>
    </div>
  )
}
