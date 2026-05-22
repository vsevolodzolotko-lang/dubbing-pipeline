# Proposed change: `config` sheet — CPS recalibration (R7.a)

**Sheet**: `config` tab, key/value rows.

## What changes — and why

Calibration based on `the_anchor` (R4 era, 31 segments × 7 langs) combined with `test4` data → N=231 samples. Methodology: per-lang CPS measured at each voice's auto-detected default playback speed (PT=0.9, TR=0.8, others=1.0). See [`docs/cps_calibration.md`](../../docs/cps_calibration.md) for details.

**TR is the largest fix** — current value of 14 was 38% too high, causing constant `final_speed=1.10/1.15` compression on TR audio in W3. 8 of 31 TR segments hit the speed cap on the last full the_anchor run.

## Changes to make in `config` sheet

Open the Google Spreadsheet → `config` tab → find each row by `key`, update `value`:

| key | current value | NEW value | reason |
|---|---|---|---|
| `cps_estimate_tr` | `14` | **`10`** | observed 10.51, delta −3.49 (HIGH conf, N=25) — **critical** |
| `cps_estimate_pl` | `14` | **`13`** | observed 13.01, delta −0.99 (HIGH conf, N=21) |
| `cps_estimate_pt` | `16` | **`15`** | observed 15.15, delta −0.85 (HIGH conf, N=30) |

**Don't change** (deltas within ±1.0):
- `cps_estimate_de` = 12 (observed 12.67, +0.67)
- `cps_estimate_es` = 15 (observed 15.30, +0.30)
- `cps_estimate_fr` = 15 (observed 15.83, +0.83)
- `cps_estimate_it` = 14 (observed 13.25, −0.75)

## How to apply

1. Open the Google Spreadsheet → `config` tab.
2. For each row in the table above, click the `value` cell and type the new number.
3. Press Enter to save. Sheets auto-saves.

No n8n re-import needed — W2/W3 read config values live on next run.

## Verification

After applying:

1. Run one full lesson through W3 (TTS included). `the_anchor` works well as a re-test.
2. Export the new `localizations` CSV.
3. Re-run:
   ```bash
   node scripts/analyze_cps.js "$HOME/Downloads/dubbing-pipeline - localizations (NN).csv"
   ```
4. Expect: TR's `delta` now within ±1.0, no more speed-retry segments (or far fewer).

If TR still hits speed retries after CPS=10:
- Either the lesson has unusually dense text for TR (rare), or
- The voice changed since calibration (re-baseline against new voice).

## Rollback

Restore old values from the table above.

## Future workflow

Whenever you swap a voice, change voice parameters (stability/style/etc.), or introduce a new content type, re-run `node scripts/analyze_cps.js` on the next 1-3 lessons and follow this same workflow. See [`docs/cps_calibration.md`](../../docs/cps_calibration.md).
