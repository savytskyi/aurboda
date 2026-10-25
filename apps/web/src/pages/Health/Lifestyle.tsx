import type { TagImpactItem, TagImpactOutcome } from '@aurboda/api-spec'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { fetchTagImpact } from '../../state/api'
import { dateWithYear, deltaTone, formatDelta, formatMetricValue } from './format'
import { HealthNav } from './HealthNav'
import { formatPValue, splitTagRows } from './lifestyleModel'
import { RangeSelector } from './RangeSelector'
import { useRange } from './useRange'
import './health.css'

const WINDOWS = [365, 1095, 3650] as const

const OUTCOME_LABELS: Record<TagImpactOutcome['metric'], string> = {
  hrv_sleep: 'Nightly HRV',
  resting_heart_rate: 'Resting HR',
  sleep_score: 'Sleep score',
}

function OutcomeRow({ outcome, minSamples }: { outcome: TagImpactOutcome; minSamples: number }) {
  const { metric } = outcome
  const tone = outcome.enough_data ? deltaTone(metric, outcome.difference) : null
  return (
    <tr>
      <td data-label="Outcome">{OUTCOME_LABELS[metric]}</td>
      <td data-label="With">{formatMetricValue(metric, outcome.mean_with)}</td>
      <td data-label="Without">{formatMetricValue(metric, outcome.mean_without)}</td>
      <td data-label="Difference">
        {outcome.enough_data ? (
          <span class={`health-delta health-delta-${tone}`}>{formatDelta(metric, outcome.difference)}</span>
        ) : (
          <span class="health-muted">Needs ≥ {minSamples} nights</span>
        )}
      </td>
      <td data-label="Nights">
        {outcome.n_with} / {outcome.n_without}
      </td>
      <td data-label="p">{outcome.enough_data ? formatPValue(outcome.p_value) : '—'}</td>
    </tr>
  )
}

function TagRows({ tag, minSamples }: { tag: TagImpactItem; minSamples: number }) {
  return (
    <tbody class="health-tag">
      <tr class="health-tag-head">
        <th colSpan={6} scope="rowgroup">
          <span class="health-tag-name">{tag.label}</span>
          <span class="health-muted">
            {' '}
            · {tag.tagged_days} tagged day{tag.tagged_days === 1 ? '' : 's'} · {dateWithYear(tag.first_date)}–
            {dateWithYear(tag.last_date)}
          </span>
        </th>
      </tr>
      {tag.outcomes.map((o) => (
        <OutcomeRow key={o.metric} outcome={o} minSamples={minSamples} />
      ))}
    </tbody>
  )
}

export function HealthLifestyle() {
  const { days, setDays } = useRange(WINDOWS, 1095)
  const query = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchTagImpact(days),
    queryKey: ['tagImpact', days],
    staleTime: 5 * 60 * 1000,
  })
  const data = query.data
  const { comparable, tooRare } = splitTagRows(data?.tags ?? [])

  return (
    <div class="health-page">
      <HealthNav />
      <div class="health-header">
        <h1>Lifestyle &amp; Insights</h1>
        <RangeSelector value={days} onChange={setDays} options={WINDOWS} />
      </div>

      <p class="health-notice">
        Oura tags compared with the following night. These are correlations in your own data, not causes —
        small samples and other things happening on the same days can produce differences.
      </p>

      {query.isLoading && <p class="health-muted">Loading tag comparisons…</p>}
      {query.isError && !data && <p class="health-error">Could not load tag comparisons.</p>}

      {data && (
        <div class={`health-content${query.isFetching ? ' is-refetching' : ''}`}>
          {comparable.length === 0 && tooRare.length === 0 && (
            <p class="health-muted">No Oura tags in this window.</p>
          )}
          {comparable.length === 0 && tooRare.length > 0 && (
            <p class="health-muted">
              No tag has {data.min_samples} or more tagged nights in this window yet, so there is nothing
              meaningful to compare. Try a longer window or keep tagging.
            </p>
          )}
          {comparable.length > 0 && (
            <div class="health-card health-table-card">
              <table class="health-tag-table">
                <caption class="health-muted">
                  {dateWithYear(data.start)}–{dateWithYear(data.end)}; nights with the tag / untagged nights
                  within 30 days of them
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Next night</th>
                    <th scope="col">With tag</th>
                    <th scope="col">Without</th>
                    <th scope="col">Difference</th>
                    <th scope="col">Nights</th>
                    <th scope="col">p-value</th>
                  </tr>
                </thead>
                {comparable.map((tag) => (
                  <TagRows key={tag.tag} tag={tag} minSamples={data.min_samples} />
                ))}
              </table>
            </div>
          )}
          {tooRare.length > 0 && (
            <div class="health-card">
              <h2>Tagged too rarely to compare</h2>
              <p class="health-muted">
                Fewer than {data.min_samples} tagged nights each:{' '}
                {tooRare.map((t) => `${t.label} (${t.tagged_days})`).join(', ')}.
              </p>
            </div>
          )}
        </div>
      )}

      <p>
        <a class="health-link" href="/correlations">
          Explore other correlations →
        </a>
      </p>
    </div>
  )
}
