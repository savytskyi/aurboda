import type { MealEstimate } from '@aurboda/api-spec'

export interface EstimateComponent {
  name: string
  portion?: string
  grams?: number
  gramsLow?: number
  gramsHigh?: number
  basis?: string
  kcal?: number
}

export interface EstimateCorrection {
  at?: string
  by?: string
  note?: string
}

export interface EstimateView {
  confidence?: string
  kcalRange?: [number, number]
  components: EstimateComponent[]
  assumed: string[]
  unknownNutrients: string[]
  corrections: EstimateCorrection[]
  recipe?: { title: string; status?: string; url?: string }
  observations: { visible: string[]; likely: string[]; unknown: string[] }
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Read the client-written estimate defensively: every field is optional and may be malformed. */
export const readEstimate = (estimate: MealEstimate | undefined): EstimateView | null => {
  if (!estimate) return null
  const low = num(rec(estimate.low).calories)
  const high = num(rec(estimate.high).calories)
  const components = (Array.isArray(estimate.components) ? estimate.components : [])
    .map(rec)
    .filter((c) => str(c.name))
    .map((c) => ({
      basis: str(c.basis),
      grams: num(c.grams),
      gramsHigh: num(c.grams_high),
      gramsLow: num(c.grams_low),
      kcal: num(c.kcal),
      name: str(c.name)!,
      portion: str(c.portion_text),
    }))
  const recipe = rec(estimate.recipe)
  const obs = rec(estimate.observations)
  return {
    assumed: strList(estimate.assumed),
    components,
    confidence: str(estimate.confidence),
    corrections: (Array.isArray(estimate.corrections) ? estimate.corrections : []).map(rec).map((c) => ({
      at: str(c.at),
      by: str(c.by),
      note: str(c.note),
    })),
    kcalRange: low !== undefined && high !== undefined ? [Math.round(low), Math.round(high)] : undefined,
    observations: {
      likely: strList(obs.likely),
      unknown: strList(obs.unknown),
      visible: strList(obs.visible),
    },
    recipe: str(recipe.title)
      ? { status: str(recipe.status), title: str(recipe.title)!, url: str(recipe.url) }
      : undefined,
    unknownNutrients: strList(estimate.unknown_nutrients),
  }
}

export const BASIS_LABELS: Record<string, string> = {
  assumed: 'assumed',
  likely: 'inferred',
  product: 'product',
  recipe: 'recipe',
  user: 'confirmed',
  visible: 'seen',
}
