/**
 * Oura names workouts in lower camelCase (`strengthTraining`, `cycling`, …).
 * Each becomes a specific Aurboda activity type: stored as the generic
 * `exercise`, distinct sessions such as a walk and the wrestling practice it
 * touches were collapsed by the same-type merge and hidden from every view.
 */

const OURA_WORKOUT_TYPES: Record<string, string> = {
  badminton: 'badminton',
  baseball: 'baseball',
  basketball: 'basketball',
  boxing: 'boxing',
  calisthenics: 'calisthenics',
  crossCountrySkiing: 'skiing',
  crossTraining: 'high_intensity_interval_training',
  cycling: 'biking',
  dancing: 'dancing',
  downhillSkiing: 'skiing',
  elliptical: 'elliptical',
  golf: 'golf',
  hiit: 'high_intensity_interval_training',
  hiking: 'hiking',
  housework: 'housework',
  houseWork: 'housework',
  iceHockey: 'ice_hockey',
  iceSkating: 'ice_skating',
  indoorCycling: 'biking_stationary',
  martialArts: 'martial_arts',
  mountainBiking: 'biking',
  pilates: 'pilates',
  rockClimbing: 'rock_climbing',
  rollerblading: 'skating',
  rowing: 'rowing',
  rugby: 'rugby',
  running: 'running',
  skating: 'skating',
  snowboarding: 'snowboarding',
  soccer: 'soccer',
  squash: 'squash',
  stairExercise: 'stair_climbing',
  strengthTraining: 'strength_training',
  stretching: 'stretching',
  surfing: 'surfing',
  swimming: 'swimming',
  tableTennis: 'table_tennis',
  tennis: 'tennis',
  treadmillRunning: 'running_treadmill',
  volleyball: 'volleyball',
  walking: 'walking',
  weightlifting: 'weightlifting',
  wrestling: 'wrestling',
  yardwork: 'yard_work',
  yoga: 'yoga',
}

const camelToSnake = (value: string): string =>
  value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replaceAll(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replaceAll(/^_+|_+$/g, '')

/**
 * The activity type for an Oura workout label. A label outside the table
 * falls back to its snake_case form when that type exists, and otherwise to
 * `other_workout` — never `exercise`, which the merge absorbs into whatever
 * specific activity overlaps it.
 */
export const ouraWorkoutActivityType = (
  activity: string | null | undefined,
  knownTypes: Set<string>,
): string => {
  if (!activity) return 'other_workout'
  const mapped = OURA_WORKOUT_TYPES[activity]
  if (mapped && knownTypes.has(mapped)) return mapped
  const snake = camelToSnake(activity)
  if (knownTypes.has(snake)) return snake
  return 'other_workout'
}

/** `strengthTraining` → `Strength Training`, for workouts Oura sends without a label. */
export const humanizeOuraActivity = (activity: string | null | undefined): string | undefined => {
  if (!activity) return undefined
  return camelToSnake(activity)
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}
