/**
 * Exercise identity for logged strength sets. Names resolve through aliases to
 * one stable key, so "bench", "bench press" and "barbell bench press" are the
 * same lift while dumbbell and incline variants stay their own exercises: an
 * alias is only ever an unambiguous name for one movement.
 */

export interface ExerciseDef {
  key: string
  name: string
  aliases: string[]
  category?: string
  muscle_group?: string
  equipment?: string
  is_bodyweight: boolean
  builtin: boolean
}

type Seed = [
  key: string,
  name: string,
  aliases: string[],
  muscle: string,
  equipment: string,
  bodyweight?: boolean,
]

const SEEDS: Seed[] = [
  [
    'bench_press',
    'Bench Press',
    ['bench', 'barbell bench', 'barbell bench press', 'flat bench', 'flat bench press', 'bp'],
    'chest',
    'barbell',
  ],
  [
    'dumbbell_bench_press',
    'Dumbbell Bench Press',
    ['dumbbell bench', 'db bench', 'db bench press', 'flat dumbbell press'],
    'chest',
    'dumbbell',
  ],
  [
    'incline_bench_press',
    'Incline Bench Press',
    ['incline bench', 'incline barbell bench', 'incline barbell bench press', 'incline barbell press'],
    'chest',
    'barbell',
  ],
  [
    'incline_dumbbell_press',
    'Incline Dumbbell Press',
    ['incline dumbbell bench', 'incline dumbbell bench press', 'incline db press', 'incline db bench'],
    'chest',
    'dumbbell',
  ],
  [
    'close_grip_bench_press',
    'Close-Grip Bench Press',
    ['close grip bench', 'cgbp', 'close grip bench press'],
    'triceps',
    'barbell',
  ],
  [
    'squat',
    'Squat',
    ['back squat', 'barbell squat', 'barbell back squat', 'high bar squat', 'low bar squat'],
    'legs',
    'barbell',
  ],
  ['front_squat', 'Front Squat', ['barbell front squat'], 'legs', 'barbell'],
  ['goblet_squat', 'Goblet Squat', [], 'legs', 'dumbbell'],
  ['deadlift', 'Deadlift', ['conventional deadlift', 'barbell deadlift', 'dl'], 'posterior chain', 'barbell'],
  ['romanian_deadlift', 'Romanian Deadlift', ['rdl', 'romanian dl'], 'hamstrings', 'barbell'],
  ['sumo_deadlift', 'Sumo Deadlift', ['sumo dl'], 'posterior chain', 'barbell'],
  [
    'trap_bar_deadlift',
    'Trap Bar Deadlift',
    ['hex bar deadlift', 'trap bar dl'],
    'posterior chain',
    'trap bar',
  ],
  [
    'overhead_press',
    'Overhead Press',
    [
      'ohp',
      'military press',
      'standing press',
      'barbell overhead press',
      'barbell shoulder press',
      'strict press',
    ],
    'shoulders',
    'barbell',
  ],
  [
    'dumbbell_shoulder_press',
    'Dumbbell Shoulder Press',
    ['db shoulder press', 'dumbbell overhead press', 'seated dumbbell press'],
    'shoulders',
    'dumbbell',
  ],
  ['push_press', 'Push Press', [], 'shoulders', 'barbell'],
  ['pull_up', 'Pull-Up', ['pullup', 'pull up', 'pullups', 'pull ups'], 'back', 'bodyweight', true],
  ['chin_up', 'Chin-Up', ['chinup', 'chin up', 'chinups', 'chin ups'], 'back', 'bodyweight', true],
  ['push_up', 'Push-Up', ['pushup', 'push up', 'press up', 'pressup'], 'chest', 'bodyweight', true],
  ['dip', 'Dip', ['dips', 'parallel bar dip', 'chest dip'], 'triceps', 'bodyweight', true],
  ['muscle_up', 'Muscle-Up', ['muscleup', 'muscle up'], 'back', 'bodyweight', true],
  ['inverted_row', 'Inverted Row', ['bodyweight row', 'australian pull up'], 'back', 'bodyweight', true],
  [
    'barbell_row',
    'Barbell Row',
    ['bent over row', 'bent over barbell row', 'bb row', 'pendlay row'],
    'back',
    'barbell',
  ],
  [
    'dumbbell_row',
    'Dumbbell Row',
    ['db row', 'one arm row', 'one arm dumbbell row', 'single arm dumbbell row'],
    'back',
    'dumbbell',
  ],
  ['lat_pulldown', 'Lat Pulldown', ['lat pull down', 'pulldown', 'pull down'], 'back', 'cable'],
  ['seated_cable_row', 'Seated Cable Row', ['cable row', 'seated row'], 'back', 'cable'],
  ['face_pull', 'Face Pull', [], 'shoulders', 'cable'],
  [
    'barbell_curl',
    'Barbell Curl',
    ['bb curl', 'barbell biceps curl', 'barbell bicep curl'],
    'biceps',
    'barbell',
  ],
  [
    'dumbbell_curl',
    'Dumbbell Curl',
    ['db curl', 'dumbbell biceps curl', 'dumbbell bicep curl'],
    'biceps',
    'dumbbell',
  ],
  ['hammer_curl', 'Hammer Curl', ['dumbbell hammer curl'], 'biceps', 'dumbbell'],
  [
    'triceps_pushdown',
    'Triceps Pushdown',
    ['tricep pushdown', 'cable pushdown', 'rope pushdown'],
    'triceps',
    'cable',
  ],
  [
    'skull_crusher',
    'Skull Crusher',
    ['lying triceps extension', 'lying tricep extension'],
    'triceps',
    'barbell',
  ],
  [
    'lateral_raise',
    'Lateral Raise',
    ['side raise', 'dumbbell lateral raise', 'lat raise', 'side lateral raise'],
    'shoulders',
    'dumbbell',
  ],
  ['leg_press', 'Leg Press', [], 'legs', 'machine'],
  ['leg_curl', 'Leg Curl', ['hamstring curl', 'lying leg curl', 'seated leg curl'], 'hamstrings', 'machine'],
  ['leg_extension', 'Leg Extension', [], 'quads', 'machine'],
  ['calf_raise', 'Calf Raise', ['standing calf raise', 'seated calf raise'], 'calves', 'machine'],
  ['lunge', 'Lunge', ['lunges', 'walking lunge', 'dumbbell lunge'], 'legs', 'dumbbell'],
  [
    'bulgarian_split_squat',
    'Bulgarian Split Squat',
    ['bss', 'split squat', 'rear foot elevated split squat'],
    'legs',
    'dumbbell',
  ],
  ['hip_thrust', 'Hip Thrust', ['barbell hip thrust'], 'glutes', 'barbell'],
  ['good_morning', 'Good Morning', [], 'hamstrings', 'barbell'],
  ['shrug', 'Shrug', ['barbell shrug', 'dumbbell shrug'], 'traps', 'barbell'],
  ['chest_fly', 'Chest Fly', ['dumbbell fly', 'dumbbell chest fly'], 'chest', 'dumbbell'],
  ['power_clean', 'Power Clean', [], 'full body', 'barbell'],
  ['clean_and_jerk', 'Clean and Jerk', ['clean & jerk', 'c&j'], 'full body', 'barbell'],
  ['snatch', 'Snatch', ['power snatch'], 'full body', 'barbell'],
  ['kettlebell_swing', 'Kettlebell Swing', ['kb swing', 'russian swing'], 'posterior chain', 'kettlebell'],
  [
    'farmers_walk',
    "Farmer's Walk",
    ['farmers carry', 'farmer walk', 'farmer carry', 'farmers walk'],
    'full body',
    'dumbbell',
  ],
  ['plank', 'Plank', ['front plank'], 'core', 'bodyweight', true],
  ['hanging_leg_raise', 'Hanging Leg Raise', ['hanging leg raises'], 'core', 'bodyweight', true],
  ['ab_wheel_rollout', 'Ab Wheel Rollout', ['ab wheel', 'ab rollout'], 'core', 'bodyweight', true],
  ['sit_up', 'Sit-Up', ['situp', 'sit up'], 'core', 'bodyweight', true],
  ['burpee', 'Burpee', [], 'full body', 'bodyweight', true],
]

export const BUILTIN_EXERCISES: ExerciseDef[] = SEEDS.map(
  ([key, name, aliases, muscle_group, equipment, bw]) => ({
    aliases,
    builtin: true,
    category: 'strength',
    equipment,
    is_bodyweight: bw ?? false,
    key,
    muscle_group,
    name,
  }),
)

/** The main lifts the Strength Progress page leads with. */
export const MAIN_LIFTS = ['bench_press', 'squat', 'deadlift', 'overhead_press']

const TOKEN_EXPANSIONS: Record<string, string> = {
  bb: 'barbell',
  bw: 'bodyweight',
  db: 'dumbbell',
  dbs: 'dumbbell',
  kb: 'kettlebell',
}

export const normalizeExerciseText = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replaceAll(/['’]/g, '')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ')

const singular = (word: string): string => {
  if (word.length <= 3 || word.endsWith('ss')) return word
  if (/(sh|ch|x|ss)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)
  return word
}

/** Text forms a name may be matched under: as written, abbreviations expanded, plurals reduced. */
const variants = (text: string): string[] => {
  const base = normalizeExerciseText(text)
  const expanded = base
    .split(' ')
    .map((w) => TOKEN_EXPANSIONS[w] ?? w)
    .join(' ')
  const singularized = expanded.split(' ').map(singular).join(' ')
  return [...new Set([base, expanded, singularized])]
}

export const exerciseKeyFromName = (name: string): string =>
  normalizeExerciseText(name).replaceAll(' ', '_').slice(0, 120) || 'exercise'

const titleCase = (text: string): string =>
  normalizeExerciseText(text)
    .split(' ')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')

export type ExerciseIndex = Map<string, ExerciseDef>

/** Lookup from every name form of every exercise; user-defined exercises win over built-ins. */
export const buildExerciseIndex = (custom: ExerciseDef[] = []): ExerciseIndex => {
  const index: ExerciseIndex = new Map()
  for (const def of [...BUILTIN_EXERCISES, ...custom]) {
    for (const name of [def.key.replaceAll('_', ' '), def.name, ...def.aliases]) {
      for (const form of variants(name)) index.set(form, def)
    }
  }
  return index
}

export interface ResolvedExercise {
  key: string
  name: string
  known: boolean
  is_bodyweight: boolean
}

export const resolveExercise = (input: string, index: ExerciseIndex): ResolvedExercise => {
  for (const form of variants(input)) {
    const def = index.get(form)
    if (def) return { is_bodyweight: def.is_bodyweight, key: def.key, known: true, name: def.name }
  }
  const singularForm = variants(input).at(-1)!
  return {
    is_bodyweight: false,
    key: exerciseKeyFromName(singularForm),
    known: false,
    name: titleCase(singularForm),
  }
}
