# Sleep Analysis

Aurboda provides dedicated sleep tracking and analysis. The Sleep page shows your sleep quality trends over configurable periods, while the sleep detail view gives you a full breakdown of individual sessions including a hypnogram, Oura scores, and HR/HRV overlays.

## The Sleep Page

The page at `/sleep` is one of the health pages (tab row: Overview, Recovery, Sleep, Activity, Stress,
Heart, Lifestyle — see [Health dashboard](health-dashboard.md)). A range selector under the title
(7 / 30 / 90 days / 1 year, default 30) scopes everything on the page and is kept in the URL as
`?range=`, so links are shareable. While a new range loads, the previous one stays on screen, dimmed.

All per-night values come from `GET /health/daily` — one value per wake day (a night belongs to the day
you woke up on), each with your 30-day personal normal (mean ± 1 SD of the 30 days before it).

### Overview cards

Five cards show the **average per night over the range**, and, underneath, how the **latest night**
compares with your 30-day normal (green when better, red when worse; neutral metrics stay grey):

- **Sleep score** -- Oura's overall sleep score.
- **Total sleep** -- `sleep_duration_sec`, Oura's total sleep for the main sleep (naps excluded).
- **Efficiency** -- `sleep_efficiency_percent`, time asleep vs. time in bed.
- **Time to fall asleep** -- `sleep_latency_sec`, shown in minutes (lower is better).
- **Time in bed** -- `time_in_bed_sec`.

A line under the cards gives the number of nights with a sleep total in the range.

### Last night

Two stacked bars split sleep into deep, light, REM and awake time: the latest night, and the average
over the range, each with minutes and percentages.

### Sleep score and duration

The sleep score trend line has a shaded band for your 30-day normal. The duration bars are colour-coded
(green 7-9 h, highlighted as a target zone; yellow 6-7 or 9+ h; red under 6 h) with a dashed average
line; they also read `sleep_duration_sec`.

If sleep sessions exist but there is no score data, the score chart says that a scoring source (Oura,
Garmin) is needed and links to Data sources.

### Sleep score contributors

Oura's seven sleep contributor scores (total sleep, efficiency, restfulness, REM, deep, latency,
timing) for the latest night as 0-100 bars, with a tick for the range average. These are scores, not
measurements — the _Efficiency score_ is not the efficiency percentage. Scores under 70 are marked
"Pay attention".

### Schedule

From `GET /health/sleep-schedule`: one bar per night from bedtime to wake time on a clock axis
(evening at the top), the average bedtime and wake time as hairlines, and Oura's optimal bedtime
window as a shaded band when Oura has found one. The header reads e.g. "Bedtime 22:10 ± 34 min ·
Wake 06:40 ± 22 min". Oura's bedtime recommendation is shown as a sentence ("Oura suggests going to
bed earlier", "Oura found an optimal bedtime window: 22:00–22:45", "Oura needs more nights to
recommend a bedtime"); a window found on an earlier day says when.

### Breathing and nighttime heart rate

Small trend charts for average SpO₂, respiratory rate and the breathing disturbance index (lower is
better), and one chart with resting HR (the lowest overnight value) and the average overnight HR.

## Sleep Detail View

Clicking a sleep session (from the Timeline, Data Browser, or elsewhere) opens a detailed view showing:

### Hypnogram

A colored chart showing your progression through sleep stages over the night:

- **Awake** (amber, top)
- **REM** (purple)
- **Light** (light blue)
- **Deep** (indigo, bottom)

Heart rate (red) and HRV (teal) lines can be overlaid on the hypnogram. Hovering shows exact values at any point in time.

### Sleep Metrics

When connected to Oura: Sleep Score, Efficiency, Restfulness, Deep Score, and REM Score displayed as metric cards.

Time fields show "In Bed" (total time in bed), "Asleep" (actual sleep time excluding awake periods), and average HRV during the session.

### Additional Context

- **Music** playing during the session (via Last.fm).
- **Sleep location** -- the place where you slept, determined by finding the location visit with the longest overlap during the sleep window.
- **Source records** -- if the sleep was merged from multiple sources (e.g., Oura + Health Connect), shows each source with links.
- **Notes** -- attach comments to any sleep session.

## Primary vs. Evening Sleep

The daily summary distinguishes two sleep slots:

- **Primary sleep**: The session you woke up from on a given date. This is the session Oura's sleep score evaluates.
- **Evening sleep**: The session that started in the evening and continues into the next day.

Sleep dates use the **wake-up convention**: a session starting at 11pm on March 7 and ending at 7am on March 8 has a sleep date of March 8.

## What Data It Needs

| Feature                     | Data source                                      |
| --------------------------- | ------------------------------------------------ |
| Sleep sessions              | Oura, Garmin, or Health Connect                  |
| Sleep stages (hypnogram)    | Health Connect (via Oura/Garmin or watch)        |
| Sleep scores and components | Oura (primary source), Garmin (sleep score only) |
| HR/HRV during sleep         | Oura, Garmin, or Health Connect                  |
| Sleep location              | OwnTracks                                        |

The Sleep page works with any sleep source, but Oura provides the richest data (scores, sub-components, stages).

## Known Limitations

- Sleep components (deep, REM, restfulness, timing) are **Oura-specific**. They don't appear for Garmin-only or Health Connect-only users.
- The Sleep page does not track **sleep debt** or **sleep need** -- it shows quality metrics but not how much sleep you need vs. how much you're getting. (See issue #302 for planned sleep debt tracking.)
- The Sleep page reads per-night health metrics that Oura fills in full; with other sources (Garmin, Health Connect) only some cards and charts have data, while their sleep sessions still show in the Timeline and the sleep detail view.
- Bedtime regularity is shown as the schedule chart's bedtime/wake spread; there is no longer-term regularity score beyond Oura's "Timing" contributor.
