import type { TagImpactItem } from '@aurboda/api-spec'

export const tagHasEnoughData = (tag: TagImpactItem): boolean => tag.outcomes.some((o) => o.enough_data)

/** "p = 0.03", "p = 0.004", "p < 0.001"; "—" when there is no test. */
export const formatPValue = (p: number | null): string => {
  if (p === null || !Number.isFinite(p)) return '—'
  if (p < 0.001) return 'p < 0.001'
  return `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`
}

/** Tags with enough tagged nights to compare, and the rest, each keeping the API order. */
export const splitTagRows = (
  tags: readonly TagImpactItem[],
): { comparable: TagImpactItem[]; tooRare: TagImpactItem[] } => ({
  comparable: tags.filter(tagHasEnoughData),
  tooRare: tags.filter((t) => !tagHasEnoughData(t)),
})
