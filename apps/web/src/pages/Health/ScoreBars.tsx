import { formatMetricValue, metricLabel } from './format'
import './health.css'

export const PAY_ATTENTION_BELOW = 70

export interface ScoreBarItem {
  metric: string
  value: number | null
  /** Range average, drawn as a small tick. */
  average?: number | null
}

export interface ScoreBarsProps {
  items: ScoreBarItem[]
  /**
   * Scores below this are flagged "Pay attention" (Oura's own cut-off for its
   * readiness, sleep and activity contributors). Null turns the flag off for
   * scores on another scale, such as resilience contributors.
   */
  attentionBelow?: number | null
}

const clamp = (v: number) => Math.min(100, Math.max(0, v))

/** The wrap reserves 2.5rem on the right for the label, so a share of the track is a share of (wrap − 2.5rem). */
export function ScoreBars({ items, attentionBelow = PAY_ATTENTION_BELOW }: ScoreBarsProps) {
  const hasAverage = items.some((i) => i.average !== null && i.average !== undefined)
  return (
    <div class="health-score-bars">
      <ul>
        {items.map((item) => {
          const label = metricLabel(item.metric)
          const low = attentionBelow !== null && item.value !== null && item.value < attentionBelow
          const avg = item.average ?? null
          return (
            <li key={item.metric} class="health-score-row">
              <div class="health-score-label">
                <span>{label}</span>
                {low && (
                  <span class="health-score-attention">
                    <span class="health-status-icon health-status-watch" aria-hidden="true">
                      ▲
                    </span>
                    Pay attention
                  </span>
                )}
              </div>
              <div
                class="health-score-track-wrap"
                role="img"
                aria-label={`${label}: ${formatMetricValue(item.metric, item.value)} of 100${
                  avg === null ? '' : `, range average ${formatMetricValue(item.metric, avg)}`
                }`}
              >
                <div class="health-score-track">
                  {item.value !== null && (
                    <div
                      class={`health-score-fill${low ? ' health-score-fill-low' : ''}`}
                      style={{ width: `${clamp(item.value)}%` }}
                    />
                  )}
                  {avg !== null && (
                    <div
                      class="health-score-avg"
                      style={{ left: `${clamp(avg)}%` }}
                      title={`Range average ${formatMetricValue(item.metric, avg)}`}
                    />
                  )}
                </div>
              </div>
              <span class="health-score-value">{formatMetricValue(item.metric, item.value)}</span>
            </li>
          )
        })}
      </ul>
      {hasAverage && (
        <div class="health-score-note">
          <span class="health-score-avg-key" aria-hidden="true" /> average over the selected range
        </div>
      )}
    </div>
  )
}
