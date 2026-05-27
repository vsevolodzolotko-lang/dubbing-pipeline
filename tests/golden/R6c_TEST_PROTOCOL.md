# R6.c Cheap Test Protocol — W2-only, no W3

## Goal

Test the 3 R6.c prompt changes (Adapt traps + translate consistency + Verify FR formality) on **5 surgically chosen EN segments** that cover all known bugs from `the_anchor` evaluation. Skip W3/TTS entirely (90% of cost). Read translation output from `segments` sheet directly.

## Estimated cost

- 5 segments × Sonnet translate + verify + Gemini editor + maybe 1-2 Adapt calls = ~$0.20-0.50.
- vs ~$5-10 for full the_anchor re-run with TTS.

## Step 1 — apply prompt changes in Sheets

Open `prompts` tab. Replace `value` cells for THREE rows by copy-pasting from these files:

| Row key | File |
|---|---|
| `adapt_shorten_system` | `prompts/proposed_changes/adapt_shorten_system.md` |
| `translate_system` | `prompts/proposed_changes/translate_system_r6c.md` |
| `qa_verify_system` | `prompts/proposed_changes/qa_verify_system_r6c.md` |

Apply all 3 together. Don't run anything between — they reinforce each other.

## Step 2 — add 5 test rows to `segments` sheet

Add these rows (anywhere in segments tab — order doesn't matter as long as all 5 are there together):

| segment_id | en_text | en_start_sec | en_end_sec | en_duration_sec | segment_type | movement_keywords | status |
|---|---|---|---|---|---|---|---|
| test_r6c_seg_001 | Take a deep breath through the nose and let it slowly escape through the mouth. | 0 | 7 | 7.0 | instruction | inhale, exhale, breath | pending |
| test_r6c_seg_002 | I am valid. | 7 | 8 | 1.0 | narrative | (empty) | pending |
| test_r6c_seg_003 | I am enough. | 8 | 9.5 | 1.5 | narrative | (empty) | pending |
| test_r6c_seg_004 | I am enough. | 9.5 | 11 | 1.5 | narrative | (empty) | pending |
| test_r6c_seg_005 | I am enough. | 11 | 12.5 | 1.5 | narrative | (empty) | pending |

Leave all `<lang>_text` and `<lang>_adaptation_attempts` columns EMPTY (W2 will fill them).

## Step 3 — run W2 with lesson_id=test_r6c

Two options:

### Option A: pin data on Manual Trigger (cleanest, no code change)

1. Open `W2_Translate_v2` in n8n.
2. Click on the `Manual Trigger` node (top of workflow).
3. Click "Set pinned data" → paste:
   ```json
   [{"lesson_id": "test_r6c"}]
   ```
4. Click "Execute Workflow".
5. After test: click `Manual Trigger` → "Unpin data" (or leave — pinned data is only used for manual runs, not for Drive-triggered runs from W_Master).

### Option B: temporarily edit `Get Params` node

If pinned data doesn't work in your n8n version:

1. Open `W2_Translate_v2` → click `Get Params` Code node.
2. Change `const lesson_id = incoming.lesson_id || null;` to `const lesson_id = incoming.lesson_id || 'test_r6c';`.
3. Run W2.
4. **REVERT** the change immediately after test.

## Step 4 — read results

Open `segments` sheet, look at the 5 `test_r6c_seg_00X` rows. The `de_text`/`es_text`/`fr_text`/`pl_text`/`pt_text`/`it_text`/`tr_text` columns should be populated.

## What to check

Copy the translated values into a comparison table. Expected outputs:

### test_r6c_seg_001 — "Take a deep breath through the nose..."

**Goal**: FR formality enforcement.

- FR: must use TU ("Prends une respiration..."). **Must NOT use "Prenez/laissez/Vous"**.
- All 6 other langs: standard informal.

### test_r6c_seg_002 — "I am valid."

**Goal**: false-friend traps + Adapt awareness.

- DE: "Ich bin wertvoll." or "Ich bin richtig, so wie ich bin." (**NOT** "Ich bin gültig")
- FR: "Je suis légitime." or "J'ai ma place." (**NOT** "Je suis valide")
- ES: "Yo valgo." or "Tengo valor." (**NOT** "Soy válido")
- PT: "Eu tenho valor." or "Eu importo." (**NOT** "Sou válido")
- IT: "Ho valore." or "Sono prezioso." (**NOT** "Sono valido")
- PL: "Jestem ważny." (acceptable)
- TR: "Değerliyim." (**NOT** "Geçerliyim")

### test_r6c_seg_003, 004, 005 — "I am enough." × 3

**Goal**: cross-segment consistency.

For each lang, the 3 translations must be **IDENTICAL** across all 3 segments. Pick the best per language; the variation Gemini caught (IT vado-bene-così/sufficiente swap) should NOT happen.

Also check false-friend avoidance:
- FR: "Je suis assez." (avoid "Je suis suffisant")
- PL: "Jestem wystarczający." (**NOT** bare "Jestem dość")

## Reporting back

Paste the relevant `_text` columns for the 5 segments. I'll do the linguistic diff and confirm/reject R6.c.

## Cleanup

After test:
- Optional: delete the 5 `test_r6c_seg_*` rows from segments sheet (or keep as regression corpus for future rounds).
- Revert `Get Params` if you took Option B.
- Unpin Manual Trigger data if you took Option A.
