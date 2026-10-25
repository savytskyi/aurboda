import type { HealthAge, HealthDailyPoint } from '@aurboda/api-spec'

export const VO2_MIN_READINGS = 5

/** VO₂ max readings in a plausible human range; Oura's early readings (e.g. 10) are not. */
export const validVo2Max = (points: readonly HealthDailyPoint[]): HealthDailyPoint[] =>
  points.filter((p) => p.value >= 15 && p.value <= 90)

export const hasEnoughVo2Max = (points: readonly HealthDailyPoint[]): boolean =>
  validVo2Max(points).length >= VO2_MIN_READINGS

/** "1 year below your age", "3 years above your age", "Same as your age"; null without both. */
export const cardioAgeSentence = (cardioAge: number | null, age: number | null): string | null => {
  if (cardioAge === null || age === null) return null
  const diff = Math.round(cardioAge) - Math.round(age)
  if (diff === 0) return 'Same as your age'
  const years = Math.abs(diff)
  return `${years} year${years === 1 ? '' : 's'} ${diff < 0 ? 'below' : 'above'} your age`
}

export const ageSourceCaption = (age: HealthAge | null): string =>
  age === null
    ? 'Set your birth date in Settings to compare'
    : age.source === 'birth_date'
      ? 'From your birth date'
      : 'From your Oura profile'
