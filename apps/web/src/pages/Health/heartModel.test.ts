import { describe, expect, it } from 'vitest'

import { ageSourceCaption, cardioAgeSentence, hasEnoughVo2Max, validVo2Max } from './heartModel'

const p = (value: number, i = 0) => ({
  baseline: null,
  date: `2026-01-${String(i + 1).padStart(2, '0')}`,
  value,
})

describe('hasEnoughVo2Max', () => {
  it('needs at least five readings between 15 and 90', () => {
    expect(hasEnoughVo2Max([10, 31].map(p))).toBe(false)
    expect(hasEnoughVo2Max([40, 41, 42, 43].map(p))).toBe(false)
    expect(hasEnoughVo2Max([40, 41, 42, 43, 44].map(p))).toBe(true)
    expect(hasEnoughVo2Max([10, 40, 41, 42, 43, 95].map(p))).toBe(false)
    expect(hasEnoughVo2Max([15, 90, 41, 42, 43].map(p))).toBe(true)
  })

  it('filters implausible readings', () => {
    expect(validVo2Max([10, 31, 100].map(p)).map((x) => x.value)).toEqual([31])
  })
})

describe('cardioAgeSentence', () => {
  it('describes the difference only when both ages exist', () => {
    expect(cardioAgeSentence(34, 35)).toBe('1 year below your age')
    expect(cardioAgeSentence(38, 35)).toBe('3 years above your age')
    expect(cardioAgeSentence(35, 35)).toBe('Same as your age')
    expect(cardioAgeSentence(null, 35)).toBeNull()
    expect(cardioAgeSentence(34, null)).toBeNull()
  })
})

describe('ageSourceCaption', () => {
  it('names the source or asks for a birth date', () => {
    expect(ageSourceCaption({ as_of: '2026-10-24', source: 'birth_date', years: 35 })).toBe(
      'From your birth date',
    )
    expect(ageSourceCaption({ as_of: '2026-10-24', source: 'oura_personal_info', years: 35 })).toBe(
      'From your Oura profile',
    )
    expect(ageSourceCaption(null)).toBe('Set your birth date in Settings to compare')
  })
})
