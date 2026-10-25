import type { HealthDailyPoint } from '@aurboda/api-spec'

import { resilienceLevels } from '@aurboda/api-spec'
import * as d3 from 'd3'
import { useMemo } from 'preact/hooks'

import {
  AXIS_TEXT_COLOR,
  CHART_MARGIN,
  ChartEmpty,
  chartFocusProps,
  ChartTooltip,
  GRID_COLOR,
  pointerIndex,
  useChartCursor,
  XAxisLabels,
} from './chartParts'
import { parseDay, shortDate } from './format'
import { resilienceLevelLabel, resilienceLevelOf } from './stressModel'
import { daysBetween, timeTickFormat, timeTicks } from './trendChartUtils'
import { useContainerWidth } from './useContainerWidth'
import './health.css'

const COLOR = 'var(--h-series-1)'
const DOT_RING = 'var(--h-dot-ring)'
const LEFT = 84

interface LevelPoint {
  date: string
  index: number
}

/** Oura resilience level per day as a step line with the five level names on the y axis. */
export function ResilienceLevelChart({
  points,
  start,
  end,
  height = 180,
}: {
  points: HealthDailyPoint[]
  start: string
  end: string
  height?: number
}) {
  const [containerRef, width] = useContainerWidth<HTMLDivElement>()
  const levels = useMemo(
    () =>
      points.flatMap((p): LevelPoint[] => {
        const level = resilienceLevelOf(p.value)
        return level ? [{ date: p.date, index: resilienceLevels.indexOf(level) }] : []
      }),
    [points],
  )
  const days = useMemo(() => daysBetween(start, end), [start, end])
  const byDate = useMemo(() => new Map(levels.map((l) => [l.date, l])), [levels])
  const rows = useMemo(() => days.map((d) => byDate.get(d) ?? null), [days, byDate])
  const cursor = useChartCursor(levels.length)
  const enough = levels.length >= 2

  const innerWidth = Math.max(0, width - LEFT - CHART_MARGIN.right)
  const innerHeight = height - CHART_MARGIN.top - CHART_MARGIN.bottom
  const xScale = d3
    .scaleTime()
    .domain([parseDay(start), parseDay(end)])
    .range([0, innerWidth])
  const x = (day: string) => xScale(parseDay(day))
  const y = d3
    .scaleLinear()
    .domain([0, resilienceLevels.length - 1])
    .range([innerHeight, 0])
  const line = d3
    .line<LevelPoint | null>()
    .defined((d) => d !== null)
    .x((d) => x(d?.date ?? start))
    .y((d) => y(d?.index ?? 0))
    .curve(d3.curveStepAfter)
  const hover = cursor.index === null ? null : (levels[cursor.index] ?? null)
  const latest = levels.at(-1)
  const label = latest
    ? `Resilience level, latest ${resilienceLevelLabel(resilienceLevels[latest.index] ?? 'limited')} on ${shortDate(latest.date)}. Use arrow keys to read values.`
    : 'Resilience level, no data.'

  return (
    <div class="health-chart">
      <div
        ref={containerRef}
        class="health-chart-frame"
        style={{ minHeight: `${height}px` }}
        {...chartFocusProps(enough, label)}
        onKeyDown={cursor.onKeyDown}
        onBlur={cursor.clear}
      >
        {!enough && <ChartEmpty height={height} message="Not enough resilience data yet." />}
        {enough && width > 0 && (
          <svg width={width} height={height} aria-hidden="true">
            <g transform={`translate(${LEFT},${CHART_MARGIN.top})`}>
              {resilienceLevels.map((level, i) => (
                <g key={level}>
                  <line x1={0} x2={innerWidth} y1={y(i)} y2={y(i)} style={{ stroke: GRID_COLOR }} />
                  <text
                    x={-8}
                    y={y(i)}
                    dy="0.32em"
                    text-anchor="end"
                    style={{ fill: AXIS_TEXT_COLOR }}
                    font-size="11"
                  >
                    {resilienceLevelLabel(level)}
                  </text>
                </g>
              ))}
              <XAxisLabels
                ticks={timeTicks(xScale, days.length, innerWidth)}
                xOf={xScale}
                y={innerHeight}
                format={timeTickFormat(days.length)}
              />
              <path
                d={line(rows) ?? ''}
                fill="none"
                style={{ stroke: COLOR }}
                stroke-width={2}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              {latest && (
                <circle
                  cx={x(latest.date)}
                  cy={y(latest.index)}
                  r={4}
                  style={{ fill: COLOR, stroke: DOT_RING }}
                  stroke-width={2}
                />
              )}
              {hover && (
                <g pointer-events="none">
                  <line
                    x1={x(hover.date)}
                    x2={x(hover.date)}
                    y1={0}
                    y2={innerHeight}
                    style={{ stroke: AXIS_TEXT_COLOR }}
                  />
                  <circle
                    cx={x(hover.date)}
                    cy={y(hover.index)}
                    r={4}
                    style={{ fill: COLOR, stroke: DOT_RING }}
                    stroke-width={2}
                  />
                </g>
              )}
              <rect
                width={innerWidth}
                height={innerHeight}
                fill="transparent"
                onPointerMove={(event: PointerEvent) =>
                  cursor.setIndex(
                    pointerIndex(
                      event,
                      levels.map((l) => x(l.date)),
                    ),
                  )
                }
                onPointerLeave={cursor.clear}
              />
            </g>
          </svg>
        )}
        {hover && (
          <ChartTooltip anchorX={x(hover.date) + LEFT} containerWidth={width}>
            <div class="health-tooltip-date">{shortDate(hover.date)}</div>
            <div class="health-tooltip-row">
              <strong>{resilienceLevelLabel(resilienceLevels[hover.index] ?? 'limited')}</strong>
              <span class="health-tooltip-label">resilience</span>
            </div>
          </ChartTooltip>
        )}
      </div>
    </div>
  )
}
