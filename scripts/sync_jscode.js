#!/usr/bin/env node
// Sync inline jsCode strings inside workflow JSONs from the authoritative .js
// files in code_nodes/. Idempotent — re-running produces no diff when files
// already match.
//
// Mapping: workflow JSON file → { n8n node name → reference file under code_nodes/ }.
// Nodes that live inline-only (no canonical .js) are intentionally absent here.
// See code_nodes/README.md.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CODE_DIR = path.join(ROOT, 'code_nodes');
const WF_DIR = path.join(ROOT, 'workflows');

const WORKFLOWS = {
  'W_Master.json': {
    'Prepare Token Rows':         'prepare_run_token.js',
    'Build Started Slack Message':'build_started_slack.js',
  },
  'W3_Dispatch.json': {
    'Check Abort':                'check_abort_w3dispatch.js',
    'Build Stopped Slack':        'build_stopped_slack.js',
  },
  'W_Abort.json': {
    'Prep Signature':             'w_abort_prep_signature.js',
    'Verify & Parse Action':      'w_abort_verify_parse.js',
    'Prepare Abort Row':          'w_abort_prepare_row.js',
    'Build Confirm Slack':        'w_abort_build_confirm.js',
  },
  'W_Error.json': {
    'Build Error Slack':          'build_error_slack.js',
  },
  'W1_STT_and_Segment.json': {
    'Segment Transcript':    'segment_transcript.js',
  },
  'W2_Translate_v2.json': {
    'Prepare Tone Analysis': 'prepare_tone_analysis.js',
    'Parse Tone Map':        'parse_tone_analysis.js',
    'Prepare and Expand':    'prepare_and_expand.js',
    'Extract Translations':  'extract_translations.js',
    'Verify Translations':   'verify_translations.js',
    'Gemini Editor':         'gemini_editor.js',
    'OpenAI Editor':         'openai_editor.js',
    'Adapt Translations':    'adapt_translations.js',
    'Formality Lint':        'formality_lint.js',
  },
  'W3_Synthesize_v2.json': {
    'Expand TTS Jobs':          'expand_tts_jobs.js',
    'Check Timing + Pad':       'check_timing_and_pad.js',
    'Phase 2: Batch LLM+TTS':   'phase2_batch_llm_tts.js',
    'Trim Lead For Sequence':   'trim_lead_for_sequence.js',
    'Build Full Audio Per Lang':'build_full_audio_per_lang.js',
    'Build VTT Per Lang':       'build_vtt_per_lang.js',
  },
  'W_Regen.json': {
    'Regen Engine':              'regen_synthesize.js',
    'Build Full Audio Per Lang': 'build_full_audio_per_lang.js',
    'Build VTT Per Lang':        'build_vtt_per_lang.js',
  },
};

let totalChanged = 0;
let totalChecked = 0;

for (const [wfFile, nodeMap] of Object.entries(WORKFLOWS)) {
  const wfPath = path.join(WF_DIR, wfFile);
  const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
  let wfChanged = 0;

  for (const node of wf.nodes) {
    const file = nodeMap[node.name];
    if (!file) continue;
    totalChecked++;
    const src = fs.readFileSync(path.join(CODE_DIR, file), 'utf8');
    if (node.parameters?.jsCode !== src) {
      const oldLen = (node.parameters?.jsCode || '').length;
      node.parameters.jsCode = src;
      wfChanged++;
      totalChanged++;
      console.log(`  ${wfFile} :: ${node.name}  ←  ${file}  (${oldLen} → ${src.length} chars)`);
    }
  }

  if (wfChanged > 0) {
    fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + '\n', 'utf8');
    console.log(`wrote ${wfFile} (${wfChanged} node(s) updated)`);
  }
}

if (totalChanged === 0) {
  console.log(`no changes — ${totalChecked} node(s) already in sync`);
} else {
  console.log(`\nDone. ${totalChanged}/${totalChecked} node(s) updated.`);
}
