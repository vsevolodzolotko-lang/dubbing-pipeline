# CPS Calibration Workflow

## What CPS is

`cps_estimate_{lang}` in the `config` sheet tells W2 Adapt and W3 Check Timing + Pad how many characters of dubbed audio fit in one second for each language. The values are used to predict whether a translation will fit a slot before TTS runs — too high and the system under-shortens (causing speed-retry compression to fit the slot); too low and it over-shortens (losing meaning unnecessarily).

CPS is driven primarily by:
1. **Voice choice** — different ElevenLabs voices speak at different paces in the same language.
2. **Voice parameters** (stability, similarity_boost, style, default speed) — affect pacing.
3. **Content type** — instructions tend to be slower than narrative; affirmations very short.

Whenever any of these change materially, the CPS estimates can drift. This doc explains how to detect and fix that.

## When to recalibrate

- After **swapping a voice_id** in the `voices` tab for any language.
- After **changing voice params** (e.g. lowering stability for more expressive narration).
- After **content-type shift** (e.g. starting to produce educational content alongside meditative).
- **Periodically** (every 5–10 lessons), as a sanity check.

You don't need to recalibrate after prompt changes (R1–R6) — those affect text content but not the voice's chars-per-second rate.

## Quick recalibration (1-command)

```bash
node scripts/analyze_cps.js \
  "$HOME/Downloads/dubbing-pipeline - localizations (NN).csv" \
  --segments="$HOME/Downloads/dubbing-pipeline - segments (NN).csv"
```

The script prints a per-lang summary table and a "Recommended config updates" section listing which `cps_estimate_*` rows to update in the `config` sheet (only rows where |observed − current| > 1.0 cps).

To improve sample count, pass multiple lesson CSVs:

```bash
node scripts/analyze_cps.js lesson1.csv lesson2.csv lesson3.csv --segments=segments.csv
```

## Output explained

```
lang  voice_id              default_spd  N      chars  sec      obs_cps  current  recommend  delta  confidence
----  --------------------  -----------  -----  -----  -------  -------  -------  ---------  -----  ----------
tr    ywzrmJ3AgYiLqAeZAGrq         0.80     25    763    72.58    10.51    14.00      10.50  -3.49        HIGH
```

| Column | Meaning |
|---|---|
| `voice_id` | Current `voices.voice_id` for this lang (from `sheets/voices.csv` snapshot). If this changed since previous calibration, old data is stale — re-baseline against new voice. |
| `default_spd` | Auto-detected as `min(final_speed)` per lang. Some voices run below 1.0 (PT typically 0.9, TR 0.8). Speed retries (1.10, 1.15) are excluded from the CPS measurement. |
| `N` | Number of samples used (segments at default speed). |
| `obs_cps` | Observed `totalChars / totalSec` weighted mean. |
| `current` | What's configured now (from `config.csv` if exported alongside, else hardcoded defaults in `docs/config_keys.md`). |
| `recommend` | `obs_cps` rounded to nearest 0.5. |
| `delta` | `obs_cps − current`. **Update threshold: |delta| > 1.0.** |
| `confidence` | LOW (<10 samples) / MED (10–19) / HIGH (≥20). Don't trust LOW deltas. |

## Per-segment_type breakdown (optional)

When you pass `--segments=path/to/segments.csv`, the script also prints a breakdown by `segment_type` (narrative / instruction / movement):

```
lang  type         N      obs_cps  delta_vs_lang_mean
----  -----------  -----  -------  ------------------
pl    movement         2    11.65               -1.16
pl    narrative       19    13.11                0.30
```

If `|delta_vs_lang_mean|` is small (< 1.5) for all types, content classes speak similarly — current single-CPS-per-lang is fine.

If a particular content type's CPS diverges meaningfully from the lang mean (e.g. `tr | educational` is +3.0 cps versus `tr | narrative`), it's a signal that **per-content-type CPS estimates** would help. This isn't implemented today but is on the roadmap (`segments.content_class` column + `cps_estimate_{lang}_{class}` config keys).

## Step-by-step calibration

1. **Export latest CSVs** from Sheets to `~/Downloads`:
   - `localizations` tab → CSV
   - `segments` tab → CSV (optional, enables segment_type breakdown)
   - `config` tab → CSV (optional, enables current-value reading)

2. **Run the analyzer:**
   ```bash
   cd /Users/vsevolodzolotko/Documents/dubbing-pipeline
   node scripts/analyze_cps.js \
     "$HOME/Downloads/dubbing-pipeline - localizations (NN).csv" \
     --segments="$HOME/Downloads/dubbing-pipeline - segments (NN).csv"
   ```

3. **Read the recommendations.** Anything with `|delta| > 1.0` and `HIGH` confidence is worth updating. `MED` confidence — defer until more data. `LOW` confidence (<10 samples) — ignore.

4. **Edit the `config` sheet** for each recommended row:
   - Find row where `key = cps_estimate_<lang>`.
   - Change `value` to the recommended number.
   - No n8n re-import needed — W2/W3 read the value live on next run.

5. **Validate.** Run one more lesson through full W3 (TTS included). Re-run this script. Expect `|delta| < 1.0` across all langs with `HIGH` confidence. If not, repeat (rare — usually one pass converges).

6. **Document.** Add a dated entry to `DECISIONS.md` noting which values changed and based on how many samples.

## Spot-checks

- If TR consistently hits `final_speed >= 1.10` in `localizations`, CPS estimate is too HIGH (system thinks more chars fit than reality).
- If translations are obviously over-shortened (lost concepts that EN had), CPS estimate is too LOW.
- The script's "HIGH confidence" needs N≥20 samples — for a small lesson (5–10 segments × 7 langs = 35–70 rows total, ~5–10 per lang) you won't reach HIGH on a single run. Run on multiple lessons combined.

## When voice_id changes

If you swap an ElevenLabs voice:

1. The `voices.csv` snapshot in the repo will be out of date (it's a manual export). Update by re-exporting after the swap.
2. CPS calibration **starts fresh** — don't combine pre-swap and post-swap CSVs (the script doesn't know the voice changed, it'd average two unrelated rates).
3. Run the new voice on a small test lesson (e.g. `test4`), calibrate from that. Continue with full lessons after.

## Roadmap notes

Currently CPS calibration is **manual**:
1. Export CSVs.
2. Run script.
3. Edit `config` sheet.

Future (deferred): see `R7.c` in the refactoring plan for a `tts_metrics` Sheets tab that W3 writes to on every TTS call, enabling rolling-window auto-calibration + Slack alerts on drift. Not built yet because current manual cadence (every 5–10 lessons) is plenty for our scale.
