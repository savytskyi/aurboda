import type { HealthAge, HealthDailyPoint } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchHealthOverview } from '../../state/api'
import { formatMetricValue, shortDate } from './format'
import { HealthNav } from './HealthNav'
import { ageSourceCaption, cardioAgeSentence, hasEnoughVo2Max, validVo2Max } from './heartModel'
import { MetricTrendCard } from './MetricTrendCard'
import { WEARABLE_NOTE } from './overviewModel'
import { RangeSelector } from './RangeSelector'
import { latestPoint } from './series'
import { StatTile } from './StatTile'
import { useHealthDaily } from './useHealthDaily'
import { rangeDates, useRange } from './useRange'
import './health.css'

const HEART_RANGES = [90, 365, 1095] as const
const VO2_WINDOW_DAYS = 1095

const TRENDS: { caption?: string; metric: string; zeroLine?: boolean }[] = [
  { metric: 'hrv_sleep' },
  { metric: 'resting_heart_rate' },
  { metric: 'respiratory_rate' },
  {
    caption: 'Oura measures this against its own baseline of your temperature',
    metric: 'temperature_deviation',
    zeroLine: true,
  },
]

const METRICS = ['cardiovascular_age', 'pulse_wave_velocity', ...TRENDS.map((t) => t.metric)]

function Vo2MaxSection() {
  const vo2Range = rangeDates(VO2_WINDOW_DAYS)
  const { series } = useHealthDaily(['vo2_max'], vo2Range.start, vo2Range.end)
  const points = series.get('vo2_max') ?? []
  if (!hasEnoughVo2Max(points)) {
    return <p class="health-note">VO₂ max appears once Oura has enough valid readings.</p>
  }
  return (
    <section>
      <h2>VO₂ max</h2>
      <MetricTrendCard
        metric="vo2_max"
        points={validVo2Max(points)}
        start={vo2Range.start}
        end={vo2Range.end}
        caption="Last 3 years"
      />
    </section>
  )
}

function CardioSection({
  series,
  start,
  end,
  age,
  smooth,
}: {
  series: Map<string, HealthDailyPoint[]>
  start: string
  end: string
  age: HealthAge | null
  smooth: boolean
}) {
  const cardio = latestPoint(series.get('cardiovascular_age'))
  const sentence = cardioAgeSentence(cardio?.value ?? null, age?.years ?? null)
  return (
    <section>
      <h2>Cardiovascular age</h2>
      <div class="health-grid">
        <StatTile
          label="Cardiovascular age"
          value={formatMetricValue('cardiovascular_age', cardio?.value ?? null)}
          caption={cardio ? `Oura estimate, ${shortDate(cardio.date)}` : 'No estimate in this range'}
        />
        <StatTile
          label="Your age"
          value={formatMetricValue('cardiovascular_age', age?.years ?? null)}
          caption={ageSourceCaption(age)}
          href={age === null ? '/settings' : undefined}
        />
      </div>
      {sentence && <p class="health-sentence">{sentence}</p>}
      <div class="health-grid health-grid-wide">
        <MetricTrendCard
          metric="cardiovascular_age"
          points={series.get('cardiovascular_age') ?? []}
          start={start}
          end={end}
          band={false}
          smooth={smooth}
          referenceLine={age === null ? undefined : { label: `Your age ${age.years}`, value: age.years }}
        />
        <MetricTrendCard
          metric="pulse_wave_velocity"
          points={series.get('pulse_wave_velocity') ?? []}
          start={start}
          end={end}
          caption="Lower generally means more elastic arteries"
          smooth={smooth}
        />
      </div>
    </section>
  )
}

export function HealthHeart() {
  const { days, end, setDays, start } = useRange(HEART_RANGES, 365)
  const { error, isFetching, isLoading, isPlaceholderData, series } = useHealthDaily(METRICS, start, end)
  const overview = useQuery({
    queryFn: () => fetchHealthOverview(),
    queryKey: ['healthOverview'],
    staleTime: 5 * 60 * 1000,
  })
  const age = overview.data?.age ?? null
  const smooth = days >= 365

  return (
    <div class="health-page">
      <HealthNav />
      <div class="health-header">
        <h1>Heart &amp; Health</h1>
        <RangeSelector value={days} onChange={setDays} options={HEART_RANGES} />
      </div>

      <p class="health-notice">{WEARABLE_NOTE}</p>

      {isLoading && <p class="health-muted">Loading heart data…</p>}
      {error && !isPlaceholderData && series.size === 0 && (
        <p class="health-error">Could not load heart data.</p>
      )}

      <div class={`health-content${isFetching && !isLoading ? ' is-refetching' : ''}`}>
        <CardioSection series={series} start={start} end={end} age={age} smooth={smooth} />

        <section>
          <h2>Long-term trends</h2>
          <div class="health-grid health-grid-wide">
            {TRENDS.map((t) => (
              <MetricTrendCard
                key={t.metric}
                metric={t.metric}
                points={series.get(t.metric) ?? []}
                start={start}
                end={end}
                caption={t.caption}
                zeroLine={t.zeroLine}
                smooth={smooth}
              />
            ))}
          </div>
        </section>
      </div>

      <Vo2MaxSection />
    </div>
  )
}
