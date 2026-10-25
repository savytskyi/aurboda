import { describe, expect, test } from 'vitest'

import { readEstimate } from './mealEstimate'

describe('readEstimate', () => {
  test('returns null without an estimate', () => {
    expect(readEstimate(undefined)).toBeNull()
  })

  test('reads components, range, assumptions and unknown nutrients', () => {
    const view = readEstimate({
      assumed: ['olive oil'],
      components: [
        { basis: 'visible', grams: 150, kcal: 240, name: 'chicken breast', portion_text: '1 breast' },
        { basis: 'assumed', grams: 8, grams_high: 15, grams_low: 0, name: 'olive oil' },
      ],
      confidence: 'medium',
      corrections: [{ at: '2026-10-24T13:00:00+02:00', by: 'ky', note: 'no butter' }],
      high: { calories: 712.4 },
      low: { calories: 488.6 },
      recipe: {
        status: 'autocreated',
        title: 'Chicken Soup',
        url: 'http://cook/recipe/Soups/Chicken%20Soup',
      },
      unknown_nutrients: ['vitamin_d'],
    })
    expect(view?.kcalRange).toEqual([489, 712])
    expect(view?.components.map((c) => c.name)).toEqual(['chicken breast', 'olive oil'])
    expect(view?.components[0].portion).toBe('1 breast')
    expect(view?.assumed).toEqual(['olive oil'])
    expect(view?.unknownNutrients).toEqual(['vitamin_d'])
    expect(view?.recipe?.title).toBe('Chicken Soup')
    expect(view?.corrections[0].note).toBe('no butter')
  })

  test('ignores malformed fields instead of throwing', () => {
    const view = readEstimate({ components: [{ name: 3 }, 'x', { name: 'rice' }], high: 'big', recipe: [] })
    expect(view?.components.map((c) => c.name)).toEqual(['rice'])
    expect(view?.kcalRange).toBeUndefined()
    expect(view?.recipe).toBeUndefined()
  })
})
