# Google Drive Structure

The pipeline uses 5 Drive folders, identified in the operator's UI as `01_input`, `02_output`, `03_full`, `04_vtt`, `05_archive`. Folder IDs come from the config sheet — actual on-Drive folder names don't have to match the numeric prefixes, but the operator's convention does. Each folder's ID is a separate config key.

```
01_input/                            ← drive_input_folder_id
└── {lesson_id}.mp3                  EN source audio. W_Master Drive Trigger watches this folder.

02_output/                           ← drive_output_folder_id
└── {lesson_id}_seg_NNN_{lang}.wav   per-segment WAVs (one per segment × lang), zero-padded NNN
                                     written by W3 Check Timing + Pad, then trimmed in-place by
                                     Trim Lead For Sequence (concat-time alignment), then
                                     overwritten in place by W_Regen on flagged-row regen

03_full/                             ← drive_output_full_folder_id
└── {lesson_id}_full_{lang}.wav      full-lesson concatenated WAV (one per active lang)
                                     written by W3 Build Full Audio Per Lang, rewritten by
                                     W_Regen if any cell of the lesson was regenerated

04_vtt/                              ← drive_output_vtt_folder_id
└── {lesson_id}_full_{lang}.vtt      WebVTT subtitles (one per active lang)
                                     Cue timings = en_start_sec → en_end_sec (EN-aligned)
                                     Cue text   = text_translated column from localizations

05_archive/                          ← drive_archive_folder_id
└── {prev_basename}_{YYYY-MM-DD_HH-MM}/    one subfolder per W_Master run, Kyiv-local time
    ├── 01_input/{prev_lesson}.mp3         the EN source from the previous run
    ├── 02_output/{prev_lesson}_seg_*.wav  all per-segment WAVs from previous run
    ├── 03_full/{prev_lesson}_full_*.wav   all full-lesson WAVs (one per lang)
    ├── 04_vtt/{prev_lesson}_full_*.vtt    all VTT files (one per lang)
    └── sheet_snapshot_{archive_name}      Drive copy of the live Google Sheet at archive time
                                           (independent Sheet — edits to the original after this
                                            point don't affect the snapshot)
```

## File-name conventions

- **`{lesson_id}`** — derived from the source filename in `01_input/`. Example: `sleep_002.mp3` → `lesson_id = sleep_002`. Sanitized to lowercase, alphanumerics + underscore + hyphen only.
- **`seg_NNN`** — zero-padded segment number (e.g. `seg_001`, `seg_042`). Numbers assigned by W1 Deepgram STT in chronological order of EN audio.
- **`{lang}`** — ISO 639-1 lowercase: `de`, `es`, `fr`, `it`, `pl`, `pt`, `tr`. Set in `active_langs` config key.

## Per-segment WAV durations and alignment

Per-segment WAVs in `02_output/` may have **different durations across languages** for the same segment. This is intentional — non-movement segments may borrow into trailing silence (see DECISIONS `PERMISSIVE_BORROW_FOR_NONMOVEMENT_SEGMENTS_2026-06-04`). For example, `sleep_002_seg_010_de.wav` might be 4.0s while `sleep_002_seg_010_fr.wav` is 4.4s if FR's translation was slightly longer and there was trailing silence to absorb the extra.

**Invariants that ARE preserved per language:**
- `sum(per-segment_{lang}.wav)` == `{lesson_id}_full_{lang}.wav` byte-for-byte (after `Trim Lead For Sequence`)
- Each segment's speech-onset position on the timeline == `en_start_sec` of that segment (EN-aligned)
- `final_duration_sec` per segment for movement-locked segments is identical across all langs (strict alignment when `segment_type == 'movement'` OR `movement_keywords` non-empty)

So while individual files can drift in size, the full-lesson WAV per language is always the same total duration as the EN audio, with every speech-start at its EN-aligned position. This is verified by `scripts/verify_borrow_compensation.js`.

## Archive rotation on each W_Master run

Triggered every time a new file is dropped into `01_input/`:

1. **Before W1 fires**: W_Master's `Archive Previous Run` chain (11 nodes) lists all files in `01_input/`, `02_output/`, `03_full/`, `04_vtt/`, excludes any file whose Drive ID matches the just-dropped trigger file(s), and moves the remainder via Drive PATCH `addParents/removeParents` (not copy) into `05_archive/{prev_basename}_{YYYY-MM-DD_HH-MM}/{01_input,02_output,03_full,04_vtt}/`.

2. **Sheet snapshot**: also copies the live Google Sheet (all 5 tabs: `config`, `segments`, `voices`, `localizations`, `prompts`) into the archive root as `sheet_snapshot_{archive_name}` via Drive's file-copy API. Result is an independent Sheet — future edits to the original don't change it. If this copy fails → the workflow halts BEFORE any destructive operation (no data loss possible).

3. **Tab clear**: after moves complete, `segments!A2:ZZ` and `localizations!A2:ZZ` of the LIVE sheet are batch-cleared via Sheets `values:batchClear` so W1/W2/W3 start fresh. `voices`, `prompts`, `config` tabs are NOT touched (persistent setup data).

4. **W1/W2/W3 fan-out**: continue as normal. After completion, working folders contain only the new run's artifacts.

After archive rotation, the operator can drop another file at any time. The current run becomes the "previous run" for the next archive cycle.

**Restoration**: if a run goes wrong, the operator can open `05_archive/{archive_name}/` in Drive, copy files from the subfolders back into the working folders, and re-open `sheet_snapshot_{archive_name}` to restore sheet rows.

## W_Regen in-place overwrite

`W_Regen` operates ONLY on `02_output/` (per-segment WAVs) and rebuilds `03_full/` + `04_vtt/`. It does NOT touch `01_input/` or `05_archive/`. Overwrites are atomic via Drive PATCH against the existing `audio_drive_file_id` recorded in the `localizations` row — no duplicates created.
