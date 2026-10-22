/**
 * Deterministic reader for short strength logs such as a Telegram message:
 * "bench 5x5 50kg, squat 3x8 70kg", "4 sets of 10 pullups",
 * "Squat 60x10, 70x8, 80x6". Nothing is invented: a set without a stated
 * weight has no weight (bodyweight movements carry zero external load), and
 * text that does not read as sets is returned in `unparsed`.
 *
 * `AxB` is ambiguous. It reads as sets×reps, except when the first number
 * carries a weight unit, when an exercise lists several pairs without a
 * separate weight ("60x10, 70x8, 80x6" — a pyramid), or when the first number
 * is above MAX_PLAUSIBLE_SETS, where it can only be a weight.
 */

import type { ParsedStrengthText, StrengthSetInput, StrengthSetType } from '@aurboda/api-spec'

import { type ExerciseIndex, resolveExercise } from './exercise-catalog.ts'

const MAX_PLAUSIBLE_SETS = 12

const NUM = String.raw`(\d+(?:\.\d+)?)`
const WEIGHT_UNIT = String.raw`(kgs?|kilos?|lbs?|pounds?)`
const TIME_UNIT = String.raw`(s|sec|secs|seconds?|min|mins|minutes?)`
const TIMES = String.raw`\s*[x×*]\s*`

const unitOf = (raw: string | undefined): 'kg' | 'lb' | undefined => {
  if (!raw) return undefined
  return /^(lb|pound)/.test(raw) ? 'lb' : 'kg'
}

const seconds = (value: number, unit: string): number => (unit.startsWith('m') ? value * 60 : value)

interface Span {
  start: number
  end: number
}

interface SegmentParse {
  name: string
  sets: StrengthSetInput[]
  hasNumbers: boolean
}

const blank = (text: string, spans: Span[]): string => {
  let out = text
  for (const { start, end } of spans) out = out.slice(0, start) + ' '.repeat(end - start) + out.slice(end)
  return out
}

const NAME_STOPWORDS =
  /\b(sets?|reps?|of|with|at|x|for|each|kgs?|kilos?|lbs?|pounds?|working|work|bodyweight|bw|rpe|warm\s*-?\s*ups?|failure|to|drop\s*-?\s*sets?)\b/g

const setTypeOf = (segment: string): StrengthSetType | undefined => {
  if (/\bwarm\s*-?\s*ups?\b/.test(segment)) return 'warmup'
  if (/\bdrop\s*-?\s*sets?\b/.test(segment)) return 'drop_set'
  if (/\b(to\s+)?failure\b/.test(segment)) return 'failure'
  return undefined
}

const repeat = (count: number, set: StrengthSetInput): StrengthSetInput[] =>
  Array.from({ length: Math.max(0, Math.min(count, 100)) }, () => ({ ...set }))

// eslint-disable-next-line complexity -- one pass over the forms a set can be written in
const parseSegment = (segment: string): SegmentParse => {
  const spans: Span[] = []
  const take = (re: RegExp): RegExpExecArray[] => {
    const found: RegExpExecArray[] = []
    for (const m of segment.matchAll(re)) {
      const start = m.index + (m[0].length - m[0].trimStart().length)
      const end = m.index + m[0].trimEnd().length
      if (spans.some((s) => start < s.end && s.start < end)) continue
      spans.push({ end, start })
      found.push(m)
    }
    return found
  }

  const triples = take(new RegExp(`${NUM}${TIMES}${NUM}${TIMES}${NUM}\\s*${WEIGHT_UNIT}?\\b`, 'g'))
  const setsOf = take(new RegExp(`(\\d+)\\s*sets?\\s*(?:of|x)\\s*(\\d+)(?:\\s*reps?)?\\b`, 'g'))
  const pairs = take(
    new RegExp(`${NUM}\\s*${WEIGHT_UNIT}?${TIMES}${NUM}\\s*(?:${WEIGHT_UNIT}|${TIME_UNIT}|reps?)?\\b`, 'g'),
  )
  const repsOnly = take(/(\d+)\s*reps?\b/g)
  const added = take(new RegExp(`\\+\\s*${NUM}\\s*${WEIGHT_UNIT}\\b`, 'g'))
  const weights = take(new RegExp(`(?:@|\\bat\\b)?\\s*${NUM}\\s*${WEIGHT_UNIT}\\b`, 'g'))
  const rpes = take(/(?:\brpe\s*|@\s*)(\d+(?:\.\d)?)\b/g)
  const bodyweightWord = /\b(bodyweight|bw)\b/.test(segment)

  const setType = setTypeOf(segment)
  const rpeValue = rpes.map((m) => Number(m[1])).find((v) => v >= 0 && v <= 10)
  const extra: StrengthSetInput = {
    ...(setType ? { set_type: setType } : {}),
    ...(rpeValue !== undefined ? { rpe: rpeValue } : {}),
  }

  let weight: { value: number; unit: 'kg' | 'lb' } | undefined
  let bodyweight = bodyweightWord
  if (added[0]) {
    weight = { unit: unitOf(added[0][2]) ?? 'kg', value: Number(added[0][1]) }
    bodyweight = true
  } else if (weights[0]) {
    weight = { unit: unitOf(weights[0][2]) ?? 'kg', value: Number(weights[0][1]) }
  }
  const load = (): StrengthSetInput =>
    weight
      ? { weight: weight.value, weight_unit: weight.unit, ...(bodyweight ? { bodyweight: true } : {}) }
      : bodyweight
        ? { bodyweight: true, weight: 0 }
        : {}

  const sets: StrengthSetInput[] = []
  for (const m of triples) {
    const unit = unitOf(m[4]) ?? weight?.unit ?? 'kg'
    sets.push(
      ...repeat(Number(m[1]), { reps: Number(m[2]), weight: Number(m[3]), weight_unit: unit, ...extra }),
    )
  }
  for (const m of setsOf) sets.push(...repeat(Number(m[1]), { reps: Number(m[2]), ...load(), ...extra }))

  const pyramid = pairs.length >= 2 && !weight
  for (const m of pairs) {
    const a = Number(m[1])
    const aUnit = unitOf(m[2])
    const b = Number(m[3])
    const bWeightUnit = unitOf(m[4])
    const bTimeUnit = m[5]
    if (bTimeUnit) {
      sets.push(...repeat(a, { time: seconds(b, bTimeUnit), ...load(), ...extra }))
    } else if (aUnit) {
      sets.push({ reps: b, weight: a, weight_unit: aUnit, ...extra })
    } else if (bWeightUnit) {
      sets.push({ reps: a, weight: b, weight_unit: bWeightUnit, ...extra })
    } else if (pyramid || (a > MAX_PLAUSIBLE_SETS && !weight)) {
      sets.push({ reps: b, weight: a, weight_unit: 'kg', ...extra })
    } else {
      sets.push(...repeat(a, { reps: b, ...load(), ...extra }))
    }
  }
  if (sets.length === 0 && repsOnly[0]) sets.push({ reps: Number(repsOnly[0][1]), ...load(), ...extra })

  const name = blank(segment, spans)
    .replaceAll(/[^a-z&' -]+/g, ' ')
    .replace(NAME_STOPWORDS, ' ')
    .replaceAll(/(^|\s)[-']+|[-']+(\s|$)/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()

  return { hasNumbers: /\d/.test(segment), name, sets }
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** `YYYY-MM-DD` of `instant` in `tz`. */
export const localDateOf = (instant: Date, tz: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
    year: 'numeric',
  }).format(instant)

export const shiftDate = (date: string, days: number): string => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const FILLER =
  /\b(add(?:ed)?|log(?:ged)?|did|done|i|i've|ive|just|also|please|my|the|a|an|workout|session|gym|training|today'?s|yesterday'?s|today|yesterday|tonight|this\s+(?:morning|afternoon|evening))\b/g

export const parseStrengthText = (
  text: string,
  options: { now: Date; tz: string; index: ExerciseIndex },
): ParsedStrengthText => {
  let body = text
    .toLowerCase()
    .replaceAll(/[’`]/g, "'")
    .replaceAll(/(\d),(\d+)\s*(kg|lb)/g, '$1.$2$3')
    .replaceAll(/\bclean\s+and\s+jerk\b/g, 'clean & jerk')

  const today = localDateOf(options.now, options.tz)
  let date: string | undefined
  if (/\byesterday('?s)?\b/.test(body)) date = shiftDate(today, -1)
  else if (/\b(today('?s)?|tonight|this\s+(morning|afternoon|evening))\b/.test(body)) date = today
  const iso = body.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) {
    date = iso[1]
    body = body.replace(iso[0], ' ')
  }

  let time: string | undefined
  const clock = body.match(/\b(?:at\s+)?([01]?\d|2[0-3])[:.h]([0-5]\d)\b(?!\s*(kg|lb))/)
  const meridiem = body.match(/\b(?:at\s+)?(1[0-2]|0?[1-9])\s*(am|pm)\b/)
  if (clock) {
    time = `${pad(Number(clock[1]))}:${clock[2]}`
    body = body.replace(clock[0], ' ')
  } else if (meridiem) {
    const hour = (Number(meridiem[1]) % 12) + (meridiem[2] === 'pm' ? 12 : 0)
    time = `${pad(hour)}:00`
    body = body.replace(meridiem[0], ' ')
  }

  body = body.replace(FILLER, ' ').replaceAll(/\bto\b(?=\s*$)/g, ' ')

  const segments = body
    .split(/[,;\n]|\band\b|\bthen\b/)
    .map((s) => s.replaceAll(/[:]/g, ' ').replaceAll(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)

  const exercises: ParsedStrengthText['exercises'] = []
  const unparsed: string[] = []
  for (const segment of segments) {
    const parsed = parseSegment(segment)
    if (parsed.sets.length === 0) {
      if (parsed.hasNumbers || parsed.name.length > 0) unparsed.push(segment)
      continue
    }
    if (parsed.name.length === 0) {
      const previous = exercises.at(-1)
      if (previous) previous.sets.push(...parsed.sets)
      else unparsed.push(segment)
      continue
    }
    const resolved = resolveExercise(parsed.name, options.index)
    const sets = resolved.is_bodyweight
      ? parsed.sets.map((s) =>
          s.weight === undefined ? { ...s, bodyweight: true, weight: 0 } : { ...s, bodyweight: true },
        )
      : parsed.sets
    const same = exercises.find((e) => e.exercise_key === resolved.key)
    if (same) same.sets.push(...sets)
    else {
      exercises.push({
        exercise: resolved.name,
        exercise_key: resolved.key,
        input: parsed.name,
        known: resolved.known,
        sets,
      })
    }
  }

  return { date, exercises, time, unparsed }
}
