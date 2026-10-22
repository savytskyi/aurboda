# Workouts and strength training

Every exercise session — Oura, Garmin, Strava, Health Connect, Gravl, or strength sets logged by hand or through a chat assistant — appears once on the **Workouts** page (`/workouts`), with a calendar, weekly charts and a detail page per workout (`/workouts/:id`). Logged lifts are charted on **Strength Progress** (`/strength`).

On the calendar (and the dashboard's workout widget) a **solid** mark is a workout with its sets logged, or a workout that has no sets by nature (walk, ride, wrestling). An **outlined** mark is a strength session with no sets logged — typically one recorded only in Oura. The day panel labels each session _sets logged_ or _sets not logged_, and the summary counts how many strength sessions in the range have their sets logged.

## Data model

A workout is an ordinary [activity](./activity-types.md). There is no parallel workout table: the page runs the same cross-source merge as the timeline, so one physical session reported by several sources is one workout, and analytics that exclude `superseded_by` rows count it once.

Manually logged strength sets live on an `aurboda` activity of type `strength_training` with `data.manual_strength = true` and `external_id = manual-strength-<id>`. The sets use the [Gravl set shape](../gravl.md#the-set-shape) so manual and Gravl sets read the same everywhere:

| Field                          | Meaning                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `set_id`                       | Stable id, used to edit or delete one set                                                |
| `exercise`, `exercise_key`     | Display name and stable key from the exercise catalog                                    |
| `exercise_order`, `order`      | Position of the exercise in the workout, and of the set within its exercise              |
| `weight`                       | Kilograms of external load. Pounds are converted on entry. `null` = not given            |
| `bodyweight`                   | Bodyweight movement; `weight` is then the added load (0 = none)                          |
| `reps`, `time`, `distance`     | Repetitions; seconds for timed sets; metres                                              |
| `rpe`, `set_type`, `notes`     | `set_type` is `normal` (working), `warmup`, `drop_set` or `failure`                       |
| `logged_at`, `logged_via`      | When and through which channel (`hermes`, `web`, `api`, `mcp`) the set was logged         |

The activity also records `entry_channel`, `time_source` (`explicit`, `message_time`, `date_only` or `linked`), `message_time` and `last_logged_at`.

### Exercise catalog

Names resolve through aliases to one key: `bench`, `bench press`, `barbell bench press` and `BB bench` are all `bench_press`. Variants that are different lifts keep their own key — `dumbbell_bench_press`, `incline_bench_press`, `incline_dumbbell_press`. A name that is not in the catalog becomes its own key (`Zercher Squats` → `zercher_squat`) rather than being guessed into a known lift. Custom exercises and aliases: `POST /workouts/exercises`, MCP `add_exercise`.

## Oura and manual sets: one workout

Strength sessions entered in the Oura app and the sets sent afterwards are joined by a **link** (`workout_links`): a confirmed link makes the merge treat the two rows as one workout. The manual row ranks higher, so the workout shows the logged sets, and Oura's calories, times and heart rate fill in what the manual row lacks. Neither side's data is overwritten: an Oura resync updates only the Oura row, and the sets stay on the manual row.

| Case                              | Result                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| Oura first, sets later            | Linked when the sets are logged; one workout                                                    |
| Sets first, Oura later            | Linked when the Oura sync imports the session; one workout                                      |
| Sets only                         | A complete strength workout; heart rate and calories are absent, not estimated                  |
| Oura only                         | The session, marked _sets not logged_ (not "zero sets")                                         |
| Two sessions on one day           | Each set log joins at most one session; unrelated sessions are never merged                     |

### Matching

Automatic links need a unique, confident match ([`matching.ts`](../../apps/backend/src/services/workouts/matching.ts)):

- Same user, same local day, a strength-type session (`strength_training`, `weightlifting`, `calisthenics`) from another source.
- Sets logged **during** the session score 0.9; logged up to **3 h after it ended** 0.85 falling to 0.75; up to 1 h before it started 0.5; further away 0.2. With an explicit time, overlap decides.
- A date alone (e.g. "yesterday") scores 0.4: it is only ever a suggestion.
- At **0.75** or more, and with no second plausible session that day, the link is made automatically. From 0.4 it is offered as a suggestion on the detail page, with a **Merge** button.
- When the sets were logged without a time, the manual workout takes the session's times on linking; the original time is kept on the link.

The thresholds come from the Oura data this was built against: sessions entered in the Oura app last a fixed hour at an approximate start, and sets arrive by message during or shortly after training.

**Unlink** marks the pair `rejected`: they stay separate even when their times overlap, the manual workout gets its original time back, and later syncs do not link them again. When Oura later moves a session so that an automatic link no longer fits, the link drops back to a suggestion. Links made or rejected by the user are never revisited.

## Heart rate and zones

Average and maximum HR, sample count and **coverage** (share of the session's minutes with at least one sample) come from the `heart_rate` samples inside the session. Below 50 % coverage the workout is marked _sparse_; with no samples heart rate is _unavailable_ — nothing is interpolated. Oura records sparse HR during many activities.

Zone time uses the configured [HR zones](./hr-zones.md); until zones are configured (custom or from a birth date) no zone split is shown. Overlapping workouts share their samples, which the detail page points out. Nightly HRV, resting HR and readiness appear as separate _recovery context_, never as workout metrics.

## Strength Progress

For a selected exercise and period (30 days to all time): estimated 1RM (Epley, `weight × (1 + reps / 30)`, working sets of 1–12 reps only — an estimate, not a tested max), the heaviest working set per session, volume per session or week (Σ weight × reps, warm-ups excluded), reps per session, best reps at each weight, and three separate records: heaviest set, highest estimated 1RM and best volume session. Sessions are plotted where they happened; missing weeks are gaps, not zeros. The raw sets are listed below the charts.

## API

All endpoints require authentication and act on the authenticated user's own database. Workout title, times and notes are edited with `PATCH /activities/:id`, and a workout is deleted with `DELETE /activities/:id`.

| Method and path                         | MCP tool                | Purpose                                                    |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `GET /workouts?start&end&types&tz`      | `list_workouts`         | Merged workouts in a range (default: last 30 days)         |
| `GET /workouts/:id`                     | `get_workout`           | Sets, exercises, provenance, HR, links and suggestions     |
| `POST /workouts/strength`               | `log_strength_workout`  | Log sets from `text` or `exercises`; idempotent by key     |
| `POST /workouts/strength/parse`         | `parse_strength_text`   | Parse only, write nothing                                  |
| `PATCH /workouts/:id/sets/:setId`       | `update_strength_set`   | Correct one set                                            |
| `DELETE /workouts/:id/sets/:setId`      | `delete_strength_set`   | Delete one set                                             |
| `POST /workouts/:id/links`              | `link_workouts`         | Confirm two activities are one workout                     |
| `DELETE /workouts/:id/links/:linkedId`  | `unlink_workouts`       | Separate them for good                                     |
| `GET /workouts/exercises`               | `list_exercises`        | Exercise catalog with logged-set counts                    |
| `POST /workouts/exercises`              | `add_exercise`          | Custom exercise or aliases                                 |
| `GET /workouts/strength/progress`       | `strength_progress`     | Progression, PRs and raw sets of one exercise              |

### Logging sets

```http
POST /api/workouts/strength
Authorization: Bearer <token>
Idempotency-Key: telegram:<chat id>:<message id>

{
  "text": "Today bench 5x5 50kg, squat 3x8 70kg",
  "message_time": "2026-10-22T17:20:00Z",
  "tz": "Europe/Ljubljana",
  "entry_channel": "hermes"
}
```

The response carries the workout, the ids of the sets added, any link made, and `summary_text`:

```text
✅ Strength workout logged — Today

Bench Press — 5×5 @ 50 kg
Squat — 3×8 @ 70 kg

Total volume: 2,930 kg
🔗 Merged with Oura session 18:00–19:00
```

- **Idempotency.** The key may be sent as the `Idempotency-Key` header or `idempotency_key` in the body. A repeated key returns the first result with `replayed: true` and writes nothing; a request still in flight under the same key answers 409.
- **Time.** `performed_at` (or a time in the text, "at 18:00") is used as given. A different day without a time ("yesterday") is stored at local noon with `time_source: date_only`. Otherwise the message time is used, marked `message_time`, and corrected when the sets are linked to a session.
- **Grouping.** `grouping: auto` (default) appends to the latest manual strength workout of the same local day when it was last added to within **3 hours**, and starts a new workout otherwise; `new` always starts one; `append_latest` always appends to the day's latest. `workout_id` targets one workout — an Oura session's id creates the sets and links them to it.
- **Parsing.** `5x5 50kg` is sets × reps at a weight; `60x10, 70x8, 80x6` is a weight × reps pyramid; `4 sets of 10 pullups` is bodyweight; `3x12 15kg dumbbell curls`, `100kg x 3`, `plank 3x60s`, `dips 3x8 +10kg`, `warmup`, `rpe 8` and pounds (`135lbs`) are read too. A missing weight stays missing. Text that is not sets is returned in `unparsed` and named in the reply.

## Migration

Oura workouts used to be stored as the generic `exercise` type, which let the merge fold distinct sessions into each other (a walk hidden under a wrestling session). A one-time, marker-gated step on startup retypes them from their stored Oura label and recomputes supersession for the affected days; row ids, external ids and data are unchanged. New tables (`workout_links`, `exercise_definitions`, `api_idempotency_keys`) and activity types (`wrestling`, `swimming`, `yard_work`, `housework`) are additive. Workout types get distinct default colours only while they still have the shared default colour.
