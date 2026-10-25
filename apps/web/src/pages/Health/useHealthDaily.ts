import type { HealthDailyData, HealthDailyPoint } from '@aurboda/api-spec'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchHealthDaily } from '../../state/api'

export const seriesByMetric = (data: HealthDailyData | undefined): Map<string, HealthDailyPoint[]> =>
  new Map((data?.series ?? []).map((s) => [s.metric, s.points]))

export const useHealthDaily = (metrics: readonly string[], start: string, end: string, baselineDays = 30) => {
  const metricsKey = metrics.join(',')
  const query = useQuery({
    placeholderData: keepPreviousData,
    queryFn: () => fetchHealthDaily(metrics, start, end, baselineDays),
    queryKey: ['healthDaily', metricsKey, start, end, baselineDays],
    staleTime: 5 * 60 * 1000,
  })
  const series = useMemo(() => seriesByMetric(query.data), [query.data])
  return { ...query, series }
}
