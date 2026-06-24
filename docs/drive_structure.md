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
└── {lesson_id}_{YYYY-MM-DD_HH-MM}/        one subfolder per lesson, Kyiv-local time
    ├── 01_input/{lesson_id}.mp3           the EN source — COPIED here at this lesson's run start
    ├── 02_output/{lesson_id}_seg_*.wav    all per-segment WAVs — moved in at the NEXT run's start
    ├── 03_full/{lesson_id}_full_*.wav     all full-lesson WAVs (one per lang) — moved in next start
    ├── 04_vtt/{lesson_id}_full_*.vtt      all VTT files (one per lang) — moved in next start
    └── sheet_snapshot_{lesson_id}_{ts}    Drive copy of the live Google Sheet, captured at the
        [_INCOMPLETE]                       next run's start (independent Sheet). Suffixed
                                            `_INCOMPLETE` if that lesson never produced a full WAV
                                            for every active language (crashed / partial run).
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

## Self-archive at start of next run (lesson-scoped, by file_id)

Each lesson owns one archive folder. Its artifacts arrive in two checkpoints so the archive always reflects the lesson's **final** state — including any W_Regen done after the run finished — while the working folders are never scanned wholesale (no `pageSize` truncation, no "exclude the just-dropped file" race). See `W_MASTER_ARCHIVE_LESSON_SCOPED_BY_FILEID` in DECISIONS.

**Checkpoint 1 — this lesson's own run start (W_Master, before W1):**

1. **Create the lesson's archive folder** `05_archive/{lesson_id}_{YYYY-MM-DD_HH-MM}/` + a `01_input/` subfolder, and **copy** the input mp3 into it (`Copy Input to Archive`, `onError=stopWorkflow` — if the copy fails the run stops before the source is touched). Its folder ID is stored in config `last_archive_folder_id` for the next run.
2. **Delete the input from `01_input/`** right after W1 finishes (`Delete Input File`, by exact `file_id` — W1 has already downloaded the audio). The folder stays empty through synthesis, and only the known `file_id` is removed, so a batch feeder dropping the next file is never disturbed.

**Checkpoint 2 — the NEXT run's start, for the lesson that just finished (the "previous" lesson):**

3. **Identify the previous lesson** from `last_archive_folder_id` (its folder) + the `localizations` rows still in the sheet (its `segment_id` prefix → `lesson_id`; its `audio_drive_file_id` values → the exact `02_output` segment file IDs — no Drive list).
4. **Snapshot the live Google Sheet** into the previous lesson's archive folder as `sheet_snapshot_{lesson}_{ts}` (`onError=stopWorkflow`, BEFORE any move — no data loss possible). Name is suffixed `_INCOMPLETE` if not every active language produced a full WAV (crashed / partial run).
5. **Move the previous lesson's files** into its folder: segments by exact `file_id`; full/vtt by targeted name query (`name contains '{lesson}_full_'`, ≤7 each). Moves use Drive PATCH `addParents/removeParents` (no duplication), `retryOnFail=3`.
6. **Clear** `segments!A2:ZZ` + `localizations!A2:ZZ` of the live sheet so W1/W2/W3 start fresh. `voices`, `prompts`, `config` are NOT touched.

Because the previous lesson's full WAVs stay in `03_full/` until this point, the operator UI keeps showing that lesson as **COMPLETE** (and W_Regen can still rewrite it in place) right up until the next run starts — and the archive captures whatever the final state was.

**Restoration**: open `05_archive/{lesson_id}_{ts}/` in Drive, copy files from the subfolders back into the working folders, and re-open `sheet_snapshot_{lesson}_{ts}` to restore sheet rows. A failed run leaves the input (already copied to its archive folder), the partial outputs, and the sheet rows all intact — nothing is archived or cleared until a subsequent run succeeds in starting.

## W_Regen in-place overwrite

`W_Regen` operates ONLY on `02_output/` (per-segment WAVs) and rebuilds `03_full/` + `04_vtt/`. It does NOT touch `01_input/` or `05_archive/`. Overwrites are atomic via Drive PATCH against the existing `audio_drive_file_id` recorded in the `localizations` row — no duplicates created.
