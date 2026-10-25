import './health.css'

export const RANGE_OPTIONS = [7, 30, 90] as const
export const RANGE_OPTIONS_WITH_YEAR = [7, 30, 90, 365] as const

export const rangeOptions = (includeYear: boolean): readonly number[] =>
  includeYear ? RANGE_OPTIONS_WITH_YEAR : RANGE_OPTIONS

export const optionLabel = (days: number): string =>
  days >= 365 && days % 365 === 0 ? `${days / 365} y` : `${days} days`

export interface RangeSelectorProps {
  value: number
  onChange: (days: number) => void
  /** Adds a 1-year option. */
  includeYear?: boolean
  /** Replaces the default 7 / 30 / 90 (/ 1 y) options. */
  options?: readonly number[]
}

export function RangeSelector({ value, onChange, includeYear = false, options }: RangeSelectorProps) {
  return (
    <div class="health-range" role="group" aria-label="Date range">
      {(options ?? rangeOptions(includeYear)).map((days) => (
        <button
          key={days}
          type="button"
          class="health-range-option"
          aria-pressed={value === days}
          onClick={() => onChange(days)}
        >
          {optionLabel(days)}
        </button>
      ))}
    </div>
  )
}
