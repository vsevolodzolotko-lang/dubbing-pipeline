# Golden Regression Tests

Snapshots of pipeline output for a fixed test lesson, used to diff before/after refactoring rounds. **Not part of production workflow** — these only exist to catch regressions when we edit prompts or Code nodes on the `experiment/external-review-refactor` branch.

## Purpose

When refactoring prompts (`prompts` tab in Sheets) or Code nodes (`workflows/W2_Translate_v2.json`, `workflows/W3_Synthesize_v2.json`), we want a fixed reference point to confirm:

- No language drops out
- No `needs_attention=true` regression
- Translation content changes are intended (not accidental quality drops)
- TTS timing/speed metrics stay within reasonable bounds

## Fixed lesson: `test4` (2 segments)

Small (~30s audio, 2 EN segments). 2 × 7 langs = 14 rows in `localizations`. One full pipeline pass (W1+W2+W3) takes ~1 minute. Cost per re-run ≈ $0.30-0.50.

## Files in this directory

- `test4_baseline.csv` — frozen snapshot of `localizations` rows for `test4`, taken at the start of refactoring. Updated only when a refactoring round's diff is reviewed and accepted.
- `test4_after.csv` — temporary snapshot taken after each round, compared against baseline. Overwritten each round.

## How to export a snapshot from Sheets

1. Open the Google Spreadsheet → `localizations` tab.
2. Identify the segment_ids that belong to `test4` (look at `segments` tab, note the segment_ids from this lesson).
3. Filter `localizations` rows where `segment_id` matches any of those.
4. Copy header row + the 14 filtered rows.
5. Paste into a new CSV file at `tests/golden/test4_baseline.csv` (or `_after.csv`).

Alternatively: `File → Download → Comma-separated values (.csv)`, then locally filter with `awk` or open in a spreadsheet app.

## How to re-run after a refactoring round

1. **Before** any changes: confirm `test4_baseline.csv` exists and reflects current pipeline state. (If it's stale, re-export before starting the round.)
2. **Apply the round's changes** (commit them locally).
3. **Clear** the rows for `test4` from `localizations` in Sheets (otherwise duplicates).
4. **Re-run** the pipeline on the same `test4` audio file via W_Master (Drive trigger) or by manually triggering W1.
5. After the run finishes, **export** the new rows: `tests/golden/test4_after.csv`.
6. **Diff**: `diff tests/golden/test4_baseline.csv tests/golden/test4_after.csv` or open both in a diff viewer.

## What to look for in the diff

| Column changed | Meaning |
|---|---|
| `text_translated` | The translation itself changed — inspect manually. Intended improvement, or regression? |
| `real_duration_sec`, `final_speed` | TTS timing shifted — usually downstream of `text_translated` change. |
| `expansion_attempts`, `shorten_retries_in_synthesize` | W3's adaptation loop fired more/less. If retries increased: regression. |
| `needs_attention=true` (was `false`) | **Regression**. Something broke. |
| `lead_silence_sec`, `tail_silence_sec`, `borrowed_sec` | Concat-time timing — should be stable unless `real_duration_sec` shifted. |
| `audio_drive_file_id` | Always changes (new files). Ignore. |

## Accepting a new baseline

If the diff is reviewed and the changes are intended improvements:

```bash
cp tests/golden/test4_after.csv tests/golden/test4_baseline.csv
git add tests/golden/test4_baseline.csv
git commit -m "test(golden): accept new test4 baseline after R<N>"
```

If the diff shows regressions: roll back the round's commits and try again.

## Rounds tracked

| Round | Baseline accepted at commit | Notes |
|---|---|---|
| R0 (initial) | TBD | Pre-refactor snapshot |
| R1 | TBD | Prompt fixes: pause-marker restoration, output-purity guards |
| R2 | TBD | loadPrompt regex + leak check |
| R3 | TBD | 7-lang validation + hash logging |
| R4 | TBD | Differentiated Verify vs Editor |
| R5 | TBD | translate_system rewrite |
| R6 | TBD | adapt consolidation + ToV split |
