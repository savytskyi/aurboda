import './health.css'

export type StatusTone = 'good' | 'watch' | 'alert' | 'info' | 'positive'

export const STATUS_ICONS: Record<StatusTone, string> = {
  alert: '●',
  good: '✓',
  info: 'ℹ',
  positive: '✓',
  watch: '▲',
}

export interface StatusChipProps {
  tone: StatusTone
  label: string
  /** Overrides the tone's default icon (e.g. ▼ for "Below normal"). */
  icon?: string
}

export function StatusChip({ tone, label, icon }: StatusChipProps) {
  return (
    <span class={`health-status health-status-${tone}`}>
      <span class="health-status-icon" aria-hidden="true">
        {icon ?? STATUS_ICONS[tone]}
      </span>
      {label}
    </span>
  )
}
