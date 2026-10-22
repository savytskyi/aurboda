/**
 * Whether a manually logged strength workout and a synced session (Oura,
 * Garmin, Health Connect, …) are the same training session.
 *
 * Tuned on the Oura data this was built against: strength sessions entered in
 * the Oura app last a fixed hour at an approximate time, and sets arrive by
 * message during or shortly after the session. A shared date alone never
 * links anything; two candidate sessions both close to the message make the
 * match ambiguous and leave it a suggestion for the user to confirm.
 */

export const STRENGTH_TYPES = new Set(['strength_training', 'weightlifting', 'calisthenics'])

/** At or above, a unique candidate is linked without asking. */
export const AUTO_LINK_CONFIDENCE = 0.75
/** At or above, a candidate is offered as a suggested link. */
export const SUGGEST_CONFIDENCE = 0.4
/** Sets logged up to this long after a session ended still belong to it. */
export const LOGGED_AFTER_WINDOW_MS = 3 * 60 * 60 * 1000
/** How far around the manual workout candidates are looked for. */
export const CANDIDATE_WINDOW_MS = 8 * 60 * 60 * 1000

export type TimeSource = 'explicit' | 'message_time' | 'date_only'

export interface ManualWorkout {
  start_time: Date
  end_time?: Date
  time_source: TimeSource
  local_date: string
}

export interface CandidateSession {
  id: string
  activity_type: string
  start_time: Date
  end_time?: Date
  local_date: string
}

export interface MatchScore {
  confidence: number
  reasons: string[]
}

const minutes = (ms: number): number => Math.round(ms / 60000)

const round2 = (v: number): number => Math.round(v * 100) / 100

// eslint-disable-next-line complexity -- one rule per way the two times can relate
export const scoreMatch = (manual: ManualWorkout, candidate: CandidateSession): MatchScore => {
  const reasons: string[] = []
  if (!STRENGTH_TYPES.has(candidate.activity_type)) {
    return { confidence: 0, reasons: ['not a strength session'] }
  }
  if (candidate.activity_type !== 'strength_training') {
    reasons.push(`compatible type ${candidate.activity_type}`)
  }
  const typePenalty = candidate.activity_type === 'strength_training' ? 0 : 0.05

  const cStart = candidate.start_time.getTime()
  const cEnd = (candidate.end_time ?? candidate.start_time).getTime()
  const mStart = manual.start_time.getTime()
  const mEnd = (manual.end_time ?? manual.start_time).getTime()

  if (manual.local_date !== candidate.local_date) {
    return { confidence: 0, reasons: [...reasons, 'different local day'] }
  }

  let confidence: number
  if (manual.time_source === 'date_only') {
    confidence = 0.4
    reasons.push('same day, no time logged')
  } else if (manual.time_source === 'message_time') {
    if (mStart >= cStart && mStart <= cEnd) {
      confidence = 0.9
      reasons.push('logged during the session')
    } else if (mStart > cEnd && mStart - cEnd <= LOGGED_AFTER_WINDOW_MS) {
      confidence = 0.85 - 0.1 * ((mStart - cEnd) / LOGGED_AFTER_WINDOW_MS)
      reasons.push(`logged ${minutes(mStart - cEnd)} min after the session ended`)
    } else if (mStart < cStart && cStart - mStart <= 60 * 60 * 1000) {
      confidence = 0.5
      reasons.push(`logged ${minutes(cStart - mStart)} min before the session started`)
    } else {
      confidence = 0.2
      reasons.push(`logged ${minutes(Math.min(Math.abs(mStart - cEnd), Math.abs(cStart - mStart)))} min away`)
    }
  } else {
    const overlap = Math.min(mEnd, cEnd) - Math.max(mStart, cStart)
    const shorter = Math.max(1, Math.min(mEnd - mStart, cEnd - cStart))
    if (overlap > 0 || (mEnd === mStart && mStart >= cStart && mStart <= cEnd)) {
      const ratio = mEnd === mStart ? 1 : Math.min(1, overlap / shorter)
      confidence = 0.6 + 0.35 * ratio
      reasons.push(`times overlap ${Math.round(ratio * 100)}%`)
    } else {
      const gap = overlap === 0 ? 0 : -overlap
      confidence = gap <= 30 * 60 * 1000 ? 0.6 : gap <= 90 * 60 * 1000 ? 0.45 : 0.2
      reasons.push(`${minutes(gap)} min apart`)
    }
  }

  return { confidence: round2(Math.max(0, confidence - typePenalty)), reasons }
}

export interface RankedCandidate extends MatchScore {
  candidate: CandidateSession
}

/**
 * Scores every candidate; when more than one is plausible none is linked
 * automatically, each is capped below the auto-link threshold.
 */
export const rankCandidates = (manual: ManualWorkout, candidates: CandidateSession[]): RankedCandidate[] => {
  const scored = candidates
    .map((candidate) => ({ candidate, ...scoreMatch(manual, candidate) }))
    .filter((r) => r.confidence >= SUGGEST_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence)
  const plausible = scored.filter((r) => r.confidence >= 0.5)
  if (plausible.length <= 1) return scored
  return scored.map((r) => ({
    ...r,
    confidence: Math.min(r.confidence, AUTO_LINK_CONFIDENCE - 0.1),
    reasons: [...r.reasons, `${plausible.length} candidate sessions that day`],
  }))
}
