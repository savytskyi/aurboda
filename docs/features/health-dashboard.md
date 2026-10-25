# Health dashboard

A dashboard over the stored Oura daily data: the day's scores and overnight recovery signals against the user's own
normal, per-day histories with a normal band, the sleep schedule, and how lifestyle tags line up with the next
night. Values are consumer-wearable estimates; nothing here is a medical measurement or a diagnosis.

Schemas: [`packages/api-spec/src/schemas/health.ts`](../../packages/api-spec/src/schemas/health.ts). Service:
[`apps/backend/src/services/health/`](../../apps/backend/src/services/health/).

## Days and timezone

Every value is keyed by the local calendar day it falls on, in the request's `tz` (else the user's
`device_timezone` setting, else UTC). Oura stamps each daily document inside its own day and per-night values
(resting HR, nightly HRV, sleep totals) at the wake time of the main sleep, so a night belongs to the day you woke
up on. When several sources wrote the same day, Oura's value is used; otherwise the sources are averaged.

The service reads the stored `time_series` rows directly. `hrv_sleep` is therefore Oura's nightly average HRV, as
the Oura app shows it, not the value recomputed from 5-minute samples that the generic metric queries return.
`resting_heart_rate` is Oura's lowest overnight heart rate.

## Personal normal (baseline)

For a day _d_, the baseline of a metric is the mean and sample standard deviation of its values on the days
`[d − baseline_days, d − 1]` — the day itself is excluded. It is null when fewer than
`min_baseline_days = max(7, round(baseline_days / 2))` values exist. The overview uses `baseline_days = 30`.

A signal's `z` is `(value − mean) / sd` (null when sd is 0 or there is no baseline).

## Endpoints

| REST                             | MCP                     | What                                                                                          |
| -------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `GET /api/health/overview`       | `get_health_overview`   | One day (default today): scores, recovery signals, stress and resilience, age, insights       |
| `GET /api/health/daily`          | `get_health_daily`      | Per-day values of health metrics with their baselines (range ≤ 3660 days)                     |
| `GET /api/health/sleep-schedule` | `get_sleep_schedule`    | Bedtime and wake time per main sleep, their mean and SD, Oura's bedtime recommendation        |
| `GET /api/health/tag-impact`     | `get_tag_impact`        | Next-night HRV, sleep score and resting HR after each Oura tag against all other nights       |
| `POST /api/health/backfill-oura` | `backfill_oura_metrics` | Re-derive the activity-score contributors from stored Oura documents (see [Oura](../oura.md)) |

Invalid metrics, ranges or timezones return `400` with `{ success: false, error }`.

### Overview

- **Latest value** of a metric: the value on `date`, else the most recent within the two days before; otherwise it is
  `missing`.
- **Scores** (readiness, sleep, activity): latest value, its baseline and `delta`, context values for the same day,
  and up to two contributor scores below 70 on that day, lowest first.
- **Signals**, in order `hrv_sleep`, `resting_heart_rate`, `temperature_deviation`, `respiratory_rate`: status
  `above`/`below` at |z| ≥ 1.5, else `normal`; `insufficient_data` without a baseline; `missing` without a latest
  value. `favorable` follows the metric's direction (higher HRV, lower resting HR) and is null for neutral metrics.
- **Stress**: high-stress and restorative time for `date` (falling back two days; `is_partial_day` when that day is
  today), the latest Oura day summary within 7 days, the number of stressful days in the last 7, and the resilience
  level (latest within 7 days) with its contributors and the level 14 days earlier.
- **Age**: whole years from the `birth_date` setting, else Oura's `personal_info` age advanced by the years since
  it was fetched.

### Insights

At most three, ordered by severity (alert, watch, info, positive) and then by the size of the deviation. Rules that
compare with the normal only fire when a baseline exists.

| Id                  | Severity | Fires when                                                                                                                                                               |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recovery_strain`   | alert    | Two or more of: HRV z ≤ −1.5, resting HR z ≥ 1.5, temperature deviation ≥ +0.5 °C with z ≥ 2, respiratory rate z ≥ 2. Replaces the single-signal rules for those metrics |
| `hrv_low`           | watch    | HRV z ≤ −1.5, or HRV below mean − 1 SD on each of the last 3 nights                                                                                                      |
| `rhr_high`          | watch    | Resting HR z ≥ 1.5 and at least +3 bpm                                                                                                                                   |
| `temperature_high`  | watch    | Temperature deviation ≥ +0.5 °C and z ≥ 2                                                                                                                                |
| `respiratory_high`  | watch    | Respiratory rate z ≥ 2 and at least +0.7 breaths/min                                                                                                                     |
| `short_sleep`       | watch    | Mean sleep of the last 3 nights (3 values within 4 days) below the normal mean − 1 SD                                                                                    |
| `stressful_stretch` | watch    | 3 or more of the last 7 days summarised stressful                                                                                                                        |
| `resilience_drop`   | info     | Resilience at least one level lower than 14 days earlier                                                                                                                 |
| `no_recent_sleep`   | info     | No ring sleep on `date` or the day before (only for users who have sleep data at all)                                                                                    |
| `well_recovered`    | positive | Readiness z ≥ 1 and HRV z ≥ 0.5, and no alert or watch insight                                                                                                           |

### Sleep schedule

One main sleep per local wake day: Oura's `long_sleep`, else the longest `sleep` activity of that day. Clock values
are minutes after local midnight; a bedtime before noon is pushed past 1440, so 00:30 is 1470 and sorts after 23:30
(1410). Oura's optimal bedtime offsets (seconds from midnight) map to the same scale as `1440 + offset / 60`. The
recommendation is the latest `sleep_time` document on or before `end`; when it has no optimal window,
`last_optimal` is the most recent one that had.

### Tag impact

Oura tags are activities with a `tag_key` (custom tags keep their own activity type). A tag's exposure day is the
local day it was logged, or the day before when logged before 05:00. The outcome is the value of `hrv_sleep`,
`sleep_score` or `resting_heart_rate` on the following wake day. The comparison group is the untagged wake days
within 30 days of a tagged night, so slow drift over the years (HRV and resting HR change with fitness, age and
season) does not masquerade as a tag effect; nights without a value drop out of both groups. Each pair is compared with the shared
two-group statistics (mean difference, Cohen's d, two-sided Welch t-test); `enough_data` needs at least 5 nights in
each group. The window defaults to 1095 days. This is correlational: tags are logged on days that differ in other
ways too.

## Web pages

Code: [`apps/web/src/pages/Health/`](../../apps/web/src/pages/Health/) and
[`apps/web/src/pages/Sleep/`](../../apps/web/src/pages/Sleep/). The logged-in Home (`/`) is the overview; the
customizable widget dashboard moved to `/dashboard` (see [Dashboard](dashboard.md)). Every health page starts with
the same tab row — Overview, Recovery, Sleep, Activity, Stress, Heart, Lifestyle — and, except the overview, a
range selector under the title that scopes the whole page and is kept in the URL (`?range=30`, so links are
shareable). While a new range loads, the previous data stays on screen, dimmed. The Android app embeds the same
pages (`/?embed=1` for the overview).

Shared conventions:

- **Your normal**: charts draw the personal normal (mean ± 1 SD of the trailing 30 days, from the `baseline` of
  each point) as a light band with the mean as a thin line; the band breaks where days are missing. Deltas read
  "vs 30-day normal", in green when favourable and red when not, with ↑/↓ arrows.
- **Status** always has an icon and a label (✓ Normal, ▲ Watch, ● Alert, ℹ Info), never colour alone.
- **Charts** show a crosshair and a tooltip with every series at the hovered day; they are keyboard-focusable
  (arrow keys, Home/End, Escape) with a summary `aria-label`. A chart with fewer than two values shows a short
  message instead of axes; a missing latest value shows "—", never 0.
- Units come from `healthMetricCatalog`; one formatter (`format.ts`) turns seconds into `7h 32m`, temperatures
  into signed °C, metres into km and so on.

### Overview (`/`)

A dashboard of every main stat with its last-30-day trend. Two requests: `/health/overview` for the summary, then one
`/health/daily` call for the 30-day history behind every sparkline. Top to bottom:

- **Today** with the long date and whether last night's sleep is recorded.
- Three **score cards** — Readiness (→ Recovery), Sleep (→ Sleep), Activity (→ Activity) — with the value, its delta
  vs the 30-day normal, one context line (the weakest readiness contributor, sleep duration and efficiency, steps
  and the share of Oura's daily target) and a 30-day sparkline over the personal-normal band. A value from an
  earlier day says so ("from Oct 22"). Deltas within half a standard deviation of the normal stay uncoloured.
- Up to three **insights** (see [Insights](#insights)), or "Nothing unusual" when there are none.
- **Last night & recovery**: the dashboard's Last night widget (stage strip, resting HR and HRV) beside the four
  recovery signals (nightly HRV, resting HR, temperature deviation, respiratory rate), each with its normal range,
  a status chip and a sparkline, linking to its chart on Recovery.
- **Trends**: total sleep, sleep efficiency, steps, active calories, high stress, restorative time, resilience and
  SpO₂, each with its latest value, delta vs normal and a sparkline. Daily totals that accumulate during the day
  (steps, active calories, stress and restorative time) show the last complete day and a separate "Today so far"
  line, so a half-finished day is never compared with full days.
- A compact **stress & resilience** card: today's high-stress vs restorative split, the latest day summary and the
  resilience level with its change over two weeks.
- **Activity**: the dashboard's 7-day activity summary, the 30-day workout calendar, weekly Zone 2 minutes and
  7-day HR zones.
- The consumer-wearable note and a link to the customizable dashboard (`/dashboard`).

Every sparkline has a hover/keyboard tooltip with the day's value and normal range.

### Recovery (`/health/recovery`, 7 / 30 / 90 days / 1 year)

Readiness score with its delta and trend chart; the nine readiness contributor scores as bars for the latest day
with the range average as a tick (a score under 70 is marked "Pay attention"); and trend cards with the normal band
for nightly HRV, resting HR (lowest overnight), average overnight HR, temperature deviation (with a zero line) and
respiratory rate. The cards have `#<metric>` anchors, which the overview's signal tiles link to.

### Sleep (`/sleep`, 7 / 30 / 90 days / 1 year)

- Averages over the range of sleep score, total sleep (`sleep_duration_sec`, Oura's per-night total), efficiency,
  time to fall asleep and time in bed, each with the latest night against the 30-day normal, and the number of
  nights with a sleep total.
- Last night's stage split (deep / light / REM / awake) next to the range average.
- Sleep score trend with the normal band, and nightly duration bars coloured by the 7–9 h zone.
- The seven sleep contributor scores.
- **Schedule** (`/health/sleep-schedule`): one bar per night from bedtime to wake time on a clock axis with the
  evening at the top, mean bedtime and wake time as hairlines, Oura's optimal bedtime window shaded, the
  "Bedtime 21:10 ± 34 min · Wake 05:40 ± 22 min" line and Oura's recommendation in plain words.
- **Breathing**: average SpO₂, respiratory rate and breathing disturbance index.
- **Nighttime heart rate**: resting HR (lowest overnight) and average overnight HR on one axis.

### Activity & Training (`/health/activity`, 7 / 30 / 90 days)

- **Activity score** with its delta and trend, and the six activity contributor scores for the latest day (a note
  says training frequency and volume look at the last 7 days, recovery time at rest days). Until the contributor
  backfill has run they show an empty state, not zeros.
- **Steps vs target**: daily step bars. Oura's daily target is a walking-equivalent distance, not a step count, so
  days where `meters_to_target ≤ 0` get a ✓ above the bar and the tooltip shows the share of the target reached
  (`1 − meters_to_target / activity_target_meters`, clamped to 0–100 %). When the user has a metric goal on
  `steps` with a minimum, its daily share (the minimum spread over the goal window, e.g. 70,000 per `7d` → 10,000)
  is drawn as a dashed line. Summary: "Avg 8,640 steps · target met on 50 of 90 days" (days with target data).
- **Time by intensity**: stacked daily bars of high, medium and low activity time with range totals, and a separate
  chart of sedentary time with the day's inactivity alerts as a number above each bar.
- **Workouts** in the range (`/workouts`, the same query the Workouts page uses): icon, name, date, duration,
  calories, distance, average HR and Oura's intensity label (Easy / Moderate / Hard) when the source gives one,
  each linking to the workout; counts by intensity and total duration and calories; strength sessions with logged
  sets, set count and volume; links to the workout calendar and strength progress; and the HR-zones widget over
  the same number of days.

### Stress & Resilience (`/health/stress`, 7 / 30 / 90 days)

- The latest day's high-stress vs restorative split bar and Oura's day summary for its latest summarised day.
- **Daily balance**: diverging bars on one minutes axis — high stress above the zero line, restorative time below
  — with a Daily / Weekly toggle that sums days into ISO weeks (Monday start; the first and last week may be
  partial).
- **Day summaries**: the number of Restored, Normal and Stressful days, and a strip with one lettered dot per day
  (R / N / S, tooltip with the date and summary). `stress_day_summary` is stored as 1 restored, 2 normal,
  3 stressful.
- **Resilience** over a fixed last year, independent of the range: the current level (`resilience_score` 20 limited
  … 100 exceptional) as a chip, the three contributor scores (sleep recovery, daytime recovery, stress load) for
  the latest day, a step chart of the level with the five level names on the y axis, and a chart of the three
  contributors.

### Heart & Health (`/health/heart`, 90 days / 1 year / 3 years, default 1 year)

- The consumer-wearable note at the top.
- **Cardiovascular age** next to the user's age (from the overview's `age`, captioned "From your birth date" or
  "From your Oura profile"; without one the tile links to Settings), a sentence such as "1 year below your age"
  when both exist, the cardiovascular-age trend with the actual age as a reference line (no band — Oura already
  smooths it), and pulse-wave velocity ("Lower generally means more elastic arteries").
- **Long-term trends** with the normal band: nightly HRV, resting HR, respiratory rate and temperature deviation.
  For the 1- and 3-year ranges the line is a 7-day trailing mean (over calendar days, so gaps shorten the window)
  with the daily values as faint dots.
- **VO₂ max** is fetched over the last 3 years and shown only when there are at least 5 readings between 15 and
  90 mL/kg/min; otherwise a footnote says it appears once Oura has enough valid readings.

### Lifestyle & Insights (`/health/lifestyle`, 1 / 3 / 10 years, default 3 years)

[Tag impact](#tag-impact) as a table (cards on narrow screens), introduced as correlations in the user's own data,
not causes. Per tag: label, tagged days and first–last date; per outcome (nightly HRV, sleep score, resting HR):
the next-night mean with and without the tag, the difference, the number of nights in each group and the p-value
("p = 0.03", "p < 0.001"). The difference is coloured by the metric's direction only when `enough_data`; otherwise
it is muted with "Needs ≥ 5 tagged nights". Tags with enough data in any outcome come first, in API order within
each group. A footer links to the general correlations page.
