import type { MealEstimate, MealPhoto } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'preact/hooks'

import { fetchMealPhotoBlob } from '../../state/api'
import './MealEstimatePanel.css'
import { BASIS_LABELS, type EstimateView, readEstimate } from './mealEstimate'

const useObjectUrl = (blob: Blob | undefined): string | undefined => {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

function MealPhotoImage({
  mealId,
  photo,
  size,
}: {
  mealId: string
  photo: MealPhoto
  size: 'thumb' | 'full'
}) {
  const { data } = useQuery({
    queryFn: () => fetchMealPhotoBlob(mealId, photo.id),
    queryKey: ['meal-photo', mealId, photo.id],
    staleTime: Infinity,
  })
  const url = useObjectUrl(data)
  if (!url) return <span class={`meal-photo meal-photo-${size} meal-photo-loading`} />
  return (
    <img
      class={`meal-photo meal-photo-${size}`}
      src={url}
      alt={photo.kind === 'leftover' ? 'Leftovers' : 'Meal'}
    />
  )
}

export function MealPhotoStrip({
  mealId,
  photos,
  size = 'full',
}: {
  mealId: string
  photos: MealPhoto[] | undefined
  size?: 'thumb' | 'full'
}) {
  if (!photos || photos.length === 0) return null
  const shown = size === 'thumb' ? photos.slice(0, 1) : photos
  return (
    <div class={`meal-photos meal-photos-${size}`}>
      {shown.map((p) => (
        <MealPhotoImage key={p.id} mealId={mealId} photo={p} size={size} />
      ))}
    </div>
  )
}

export function EstimateBadge({ estimate }: { estimate: MealEstimate | undefined }) {
  const view = readEstimate(estimate)
  if (!view?.confidence) return null
  return (
    <span class={`estimate-badge estimate-${view.confidence}`} title="Estimated from photos or description">
      est. · {view.confidence}
    </span>
  )
}

export function MealThumb({ meal }: { meal: { id?: string; photos?: MealPhoto[] } }) {
  if (!meal.id || !meal.photos || meal.photos.length === 0) return null
  return (
    <a href={`/meals/${meal.id}`}>
      <MealPhotoStrip mealId={meal.id} photos={meal.photos} size="thumb" />
    </a>
  )
}

function ComponentsTable({ components }: { components: EstimateView['components'] }) {
  if (components.length === 0) return null
  return (
    <table class="estimate-components">
      <thead>
        <tr>
          <th>Component</th>
          <th>Portion</th>
          <th>Estimate</th>
          <th>Basis</th>
        </tr>
      </thead>
      <tbody>
        {components.map((c, i) => (
          <tr key={i} class={c.basis === 'assumed' ? 'estimate-assumed' : undefined}>
            <td>{c.name}</td>
            <td>{c.portion ?? ''}</td>
            <td>
              {c.grams !== undefined && `${Math.round(c.grams)} g`}
              {c.gramsLow !== undefined && c.gramsHigh !== undefined && (
                <span class="estimate-grams-range">
                  {' '}
                  ({Math.round(c.gramsLow)}–{Math.round(c.gramsHigh)})
                </span>
              )}
            </td>
            <td>{c.basis ? (BASIS_LABELS[c.basis] ?? c.basis) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Observations({ observations }: { observations: EstimateView['observations'] }) {
  const rows = [
    ['Seen', observations.visible],
    ['Likely', observations.likely],
    ['Unknown', observations.unknown],
  ] as const
  if (rows.every(([, list]) => list.length === 0)) return null
  return (
    <ul class="estimate-observations">
      {rows.map(
        ([label, list]) =>
          list.length > 0 && (
            <li key={label}>
              {label}: {list.join(', ')}
            </li>
          ),
      )}
    </ul>
  )
}

function RecipeLine({ recipe }: { recipe: EstimateView['recipe'] }) {
  if (!recipe) return null
  return (
    <p class="estimate-recipe">
      Recipe:{' '}
      {recipe.url ? (
        <a href={recipe.url} target="_blank" rel="noreferrer">
          {recipe.title}
        </a>
      ) : (
        recipe.title
      )}
      {recipe.status === 'autocreated' && <span class="estimate-tag"> [autocreated]</span>}
    </p>
  )
}

function Corrections({ corrections }: { corrections: EstimateView['corrections'] }) {
  if (corrections.length === 0) return null
  return (
    <div class="estimate-corrections">
      <h4>Corrections</h4>
      <ul>
        {corrections.map((c, i) => (
          <li key={i}>
            {c.at && <time>{c.at.slice(0, 16).replace('T', ' ')}</time>} {c.note ?? 'edited'}
            {c.by && <span class="estimate-by"> · {c.by}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MealEstimatePanel({ estimate }: { estimate: MealEstimate | undefined }) {
  const view = readEstimate(estimate)
  if (!view) return null
  return (
    <div class="meal-estimate">
      <h3>Estimate {view.confidence && <EstimateBadge estimate={estimate} />}</h3>
      {view.kcalRange && (
        <p class="estimate-range">
          Plausible range {view.kcalRange[0]}–{view.kcalRange[1]} kcal
        </p>
      )}
      <RecipeLine recipe={view.recipe} />
      <ComponentsTable components={view.components} />
      <Observations observations={view.observations} />
      {view.unknownNutrients.length > 0 && (
        <p class="estimate-unknown">
          Not known for this meal: {view.unknownNutrients.join(', ').replaceAll('_', ' ')}
        </p>
      )}
      <Corrections corrections={view.corrections} />
    </div>
  )
}
