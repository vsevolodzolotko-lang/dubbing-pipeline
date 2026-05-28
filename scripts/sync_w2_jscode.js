#!/usr/bin/env node
// Sync the inline jsCode strings inside W2_Translate_v2.json from the
// authoritative .js files in code_nodes/. Idempotent: re-running produces no
// diff when files already match. See code_nodes/README.md for the convention.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'W2_Translate_v2.json');
const CODE_DIR = path.join(ROOT, 'code_nodes');

// Map of n8n node names → reference file under code_nodes/. Verify Translations
// has no standalone reference file (it's inline-only); skip it here and patch
// it separately below.
const NODE_FILE_MAP = {
  'Prepare and Expand': 'prepare_and_expand.js',
  'Extract Translations': 'extract_translations.js',
  'Gemini Editor': 'gemini_editor.js',
  'OpenAI Editor': 'openai_editor.js',
  'Adapt Translations': 'adapt_translations.js',
  'Formality Lint': 'formality_lint.js',
};

const wf = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
let changed = 0;
for (const node of wf.nodes) {
  const file = NODE_FILE_MAP[node.name];
  if (!file) continue;
  const src = fs.readFileSync(path.join(CODE_DIR, file), 'utf8');
  if (node.parameters?.jsCode !== src) {
    node.parameters.jsCode = src;
    changed++;
    console.log(`updated: ${node.name} ← ${file}`);
  }
}

if (changed > 0) {
  fs.writeFileSync(WORKFLOW, JSON.stringify(wf, null, 2) + '\n', 'utf8');
  console.log(`\nwrote ${WORKFLOW} (${changed} node(s) updated)`);
} else {
  console.log('no changes — workflow already in sync');
}
