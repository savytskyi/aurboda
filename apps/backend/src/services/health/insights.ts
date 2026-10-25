import {
  type HealthDailyPoint,
  type HealthInsight,
  type HealthInsightSeverity,
  type HealthScoreSummary,
  type HealthSignalSummary,
  type HealthStressSummary,
  resilienceLevels,
} from '@aurboda/api-spec'

import { mean } from '../correlations/stats.ts'
import { addDays } from './days.ts'

export interface InsightInputs {
  date: string
  signals: HealthSignalSummary[]
  readiness: HealthScoreSummary
  stress: HealthStressSummary
  series: ReadonlyMap<string, HealthDailyPoint[]>
}

const MAX_INSIGHTS = 3

const severityRank: Record<HealthInsightSeverity, number> = { alert: 0, info: 2, positive: 3, watch: 1 }

const RECOVERY_HREF = '/health/recovery'
const SLEEP_HREF = '/sleep'
const STRESS_HREF = '/health/stress'

interface Candidate extends HealthInsight {
  z: number
}

const signalOf = (signals: HealthSignalSummary[], metric: string): HealthSignalSummary | undefined =>
  signals.find((s) => s.metric === metric)

const zOf = (s: HealthSignalSummary | undefined): number | null => (s?.baseline ? s.z : null)

const fmt = (v: number, decimals = 0) => v.toFixed(decimals)
const signed = (v: number, decimals = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(decimals)}`
const hours = (sec: number) => (sec / 3600).toFixed(1)

const describeSignal = (s: HealthSignalSummary): string => {
  const normal = s.baseline?.mean ?? 0
  const v = s.value ?? 0
  switch (s.metric) {
    case 'hrv_sleep':
      return `nightly HRV ${fmt(v)} ms (your normal ${fmt(normal)} ms)`
    case 'resting_heart_rate':
      return `resting heart rate ${fmt(v)} bpm (your normal ${fmt(normal)} bpm)`
    case 'temperature_deviation':
      return `temperature deviation ${signed(v)} °C (your normal ${signed(normal)} °C)`
    default:
      return `respiratory rate ${fmt(v, 1)} breaths/min (your normal ${fmt(normal, 1)})`
  }
}

const hrvOff = (s: HealthSignalSummary | undefined) => {
  const z = zOf(s)
  return z !== null && z <= -1.5
}
const rhrOff = (s: HealthSignalSummary | undefined) => {
  const z = zOf(s)
  return z !== null && z >= 1.5
}
const temperatureOff = (s: HealthSignalSummary | undefined) => {
  const z = zOf(s)
  return z !== null && z >= 2 && (s?.value ?? 0) >= 0.5
}
const respiratoryOff = (s: HealthSignalSummary | undefined) => {
  const z = zOf(s)
  return z !== null && z >= 2
}

/** The last `n` days ending on `date` each carry a value below their own normal minus one SD. */
const belowNormalEachDay = (points: HealthDailyPoint[], date: string, n: number): boolean => {
  const days = Array.from({ length: n }, (_, i) => addDays(date, -i))
  return days.every((d) => {
    const p = points.find((q) => q.date === d)
    return !!p?.baseline && p.value < p.baseline.mean - p.baseline.sd
  })
}

// eslint-disable-next-line complexity -- one branch per insight rule
const candidates = ({ date, readiness, series, signals, stress }: InsightInputs): Candidate[] => {
  const out: Candidate[] = []
  const hrv = signalOf(signals, 'hrv_sleep')
  const rhr = signalOf(signals, 'resting_heart_rate')
  const temp = signalOf(signals, 'temperature_deviation')
  const resp = signalOf(signals, 'respiratory_rate')
  const absZ = (s: HealthSignalSummary | undefined) => Math.abs(zOf(s) ?? 0)

  const strained = [
    hrvOff(hrv) && hrv,
    rhrOff(rhr) && rhr,
    temperatureOff(temp) && temp,
    respiratoryOff(resp) && resp,
  ].filter((s): s is HealthSignalSummary => !!s)
  const inStrain = new Set(strained.length >= 2 ? strained.map((s) => s.metric) : [])
  if (strained.length >= 2) {
    out.push({
      detail:
        `Last night ${strained.map(describeSignal).join('; ')}. ` +
        'A pattern like this often follows hard training, alcohol, poor sleep, or the start of an illness. ' +
        'This is not a diagnosis.',
      href: RECOVERY_HREF,
      id: 'recovery_strain',
      metrics: strained.map((s) => s.metric),
      severity: 'alert',
      title: 'Several recovery signals are off your normal',
      z: Math.max(...strained.map(absZ)),
    })
  }

  if (hrv && !inStrain.has('hrv_sleep')) {
    const low = hrvOff(hrv)
    const lowStretch = belowNormalEachDay(series.get('hrv_sleep') ?? [], date, 3)
    if (low || lowStretch) {
      out.push({
        detail: low
          ? `Last night: ${describeSignal(hrv)}.`
          : 'Your nightly HRV has been below your normal range for the last 3 nights.',
        href: RECOVERY_HREF,
        id: 'hrv_low',
        metrics: ['hrv_sleep'],
        severity: 'watch',
        title: 'Nightly HRV is below your normal',
        z: absZ(hrv),
      })
    }
  }

  if (rhr && !inStrain.has('resting_heart_rate') && rhrOff(rhr) && (rhr.delta ?? 0) >= 3) {
    out.push({
      detail: `Last night: ${describeSignal(rhr)}.`,
      href: RECOVERY_HREF,
      id: 'rhr_high',
      metrics: ['resting_heart_rate'],
      severity: 'watch',
      title: 'Resting heart rate is above your normal',
      z: absZ(rhr),
    })
  }

  if (temp && !inStrain.has('temperature_deviation') && temperatureOff(temp)) {
    out.push({
      detail: `Last night: ${describeSignal(temp)}.`,
      href: RECOVERY_HREF,
      id: 'temperature_high',
      metrics: ['temperature_deviation'],
      severity: 'watch',
      title: 'Body temperature is above your normal',
      z: absZ(temp),
    })
  }

  if (resp && !inStrain.has('respiratory_rate') && respiratoryOff(resp) && (resp.delta ?? 0) >= 0.7) {
    out.push({
      detail: `Last night: ${describeSignal(resp)}.`,
      href: RECOVERY_HREF,
      id: 'respiratory_high',
      metrics: ['respiratory_rate'],
      severity: 'watch',
      title: 'Respiratory rate is above your normal',
      z: absZ(resp),
    })
  }

  const sleepPoints = (series.get('sleep_duration_sec') ?? []).filter(
    (p) => p.date >= addDays(date, -3) && p.date <= date,
  )
  const lastThree = sleepPoints.slice(-3)
  const sleepBaseline = lastThree.at(-1)?.baseline
  const sleepMean = mean(lastThree.map((p) => p.value))
  if (
    lastThree.length === 3 &&
    sleepBaseline &&
    sleepMean !== null &&
    sleepMean < sleepBaseline.mean - sleepBaseline.sd
  ) {
    out.push({
      detail: `You slept ${hours(sleepMean)} h a night over the last 3 nights, against your normal of ${hours(sleepBaseline.mean)} h.`,
      href: SLEEP_HREF,
      id: 'short_sleep',
      metrics: ['sleep_duration_sec'],
      severity: 'watch',
      title: 'Shorter sleep than your normal',
      z: sleepBaseline.sd > 0 ? Math.abs((sleepMean - sleepBaseline.mean) / sleepBaseline.sd) : 0,
    })
  }

  if (stress.stressful_days_last_7 >= 3) {
    out.push({
      detail: `Oura summarised ${stress.stressful_days_last_7} of the last 7 days as stressful.`,
      href: STRESS_HREF,
      id: 'stressful_stretch',
      metrics: ['stress_day_summary'],
      severity: 'watch',
      title: 'A stressful stretch',
      z: 0,
    })
  }

  const { level, previous_level: previous } = stress.resilience
  if (level && previous && resilienceLevels.indexOf(level) < resilienceLevels.indexOf(previous)) {
    out.push({
      detail: `Your resilience is ${level}, down from ${previous} two weeks earlier.`,
      href: STRESS_HREF,
      id: 'resilience_drop',
      metrics: ['resilience_score'],
      severity: 'info',
      title: 'Resilience has dropped',
      z: 0,
    })
  }

  const sleepSeries = series.get('sleep_duration_sec') ?? []
  const sleptRecently = sleepSeries.some((p) => p.date === date || p.date === addDays(date, -1))
  if (sleepSeries.length > 0 && !sleptRecently) {
    out.push({
      detail: 'Your ring has no sleep for last night yet. It may still be syncing, or it was not worn.',
      href: SLEEP_HREF,
      id: 'no_recent_sleep',
      metrics: ['sleep_duration_sec'],
      severity: 'info',
      title: 'No ring sleep data for last night',
      z: 0,
    })
  }

  const readinessZ =
    readiness.baseline && readiness.baseline.sd > 0 && readiness.value !== null
      ? (readiness.value - readiness.baseline.mean) / readiness.baseline.sd
      : null
  const hrvZ = zOf(hrv)
  const concerning = out.some((c) => c.severity === 'alert' || c.severity === 'watch')
  if (!concerning && readinessZ !== null && readinessZ >= 1 && hrvZ !== null && hrvZ >= 0.5) {
    out.push({
      detail: `Readiness ${fmt(readiness.value ?? 0)} and nightly HRV are both above your normal.`,
      href: RECOVERY_HREF,
      id: 'well_recovered',
      metrics: ['readiness_score', 'hrv_sleep'],
      severity: 'positive',
      title: 'Well recovered',
      z: readinessZ,
    })
  }
  return out
}

/** At most three insights, most severe first, then the largest deviation. */
export const buildHealthInsights = (inputs: InsightInputs): HealthInsight[] =>
  candidates(inputs)
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.z - a.z)
    .slice(0, MAX_INSIGHTS)
    .map(({ z: _z, ...insight }) => insight)
