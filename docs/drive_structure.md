# Google Drive Structure

Folder layout used by the pipeline. All paths are relative to the shared Drive root.

```
input/
└── {lesson_id}.mp3          ← користувач закидає сюди оригінал (тригер для Workflow_Master)

output/
└── {lesson_id}/
    ├── de/
    │   ├── seg_001_de.mp3   ← TTS + silence padding до en_duration
    │   ├── seg_002_de.mp3
    │   └── ...
    ├── es/
    ├── fr/
    ├── it/
    ├── pl/
    ├── pt/
    └── tr/
```

## File format

Each `seg_NNN_{lang}.mp3`:
- Duration = exactly `en_duration_sec` of the corresponding EN segment
- Content = TTS audio (natural speed or speed-adjusted) + silence padding at the end if needed
- Naming: zero-padded segment number, e.g. `seg_001_de.mp3`, `seg_012_fr.mp3`

## Concatenation

Concatenating all files for a language in order produces the full dubbed lesson
aligned to the EN timeline. Any DAW or audio player that supports sequential
playback can use these files directly.

## Backup

Overwritten files during atomic regeneration are backed up to:
```
output/{lesson_id}/_backup/{lang}/seg_NNN_{lang}_{timestamp}.mp3
```
