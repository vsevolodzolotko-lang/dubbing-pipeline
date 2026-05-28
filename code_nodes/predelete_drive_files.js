// Pre-Save Cleanup — Drive deduplication before file upload.
//
// Problem: n8n googleDrive Upload node does NOT replace by name — it creates a new
// file each run, leaving duplicates in the target folder. After repeated W_Regen runs
// the full/ and vtt/ folders accumulate {lesson_id}_full_{lang}.wav, _full_{lang} (1).wav etc.
//
// This node runs BEFORE the Save node. For each input item:
//   1. Infer target folder from file extension (.wav → full folder, .vtt → vtt folder)
//   2. Drive API: list files with the same name in that folder (trashed=false)
//   3. Drive API: delete each match (hard delete, not trash)
//   4. Pass input item through unchanged so Save uploads fresh
//
// Auth: uses `httpRequestWithAuthentication` against the workflow's googleDriveOAuth2Api
// credential. The same credential the Save nodes use. If this helper is unavailable on
// the n8n version, switch this node to HTTP Request nodes with explicit credential binding.

const configMap = {};
$('Read Config').all().forEach(i => { if (i.json.key) configMap[i.json.key] = i.json.value; });

const FULL_FOLDER = configMap.drive_output_full_folder_id || configMap.drive_output_folder_id;
const VTT_FOLDER  = configMap.drive_output_vtt_folder_id  || configMap.drive_output_full_folder_id || configMap.drive_output_folder_id;

console.log(`[Pre-Save Cleanup] FULL_FOLDER=${FULL_FOLDER}, VTT_FOLDER=${VTT_FOLDER}`);

function folderForFile(fileName) {
  if (!fileName) return null;
  if (fileName.endsWith('.vtt')) return VTT_FOLDER;
  if (fileName.endsWith('.wav')) return FULL_FOLDER;
  return null;
}

const items = $input.all();
console.log(`[Pre-Save Cleanup] received ${items.length} items`);

let deleted = 0;
let searchErrors = 0;
let deleteErrors = 0;
let zeroMatches = 0;

for (const item of items) {
  const fileName = item.json.file_name;
  const folderId = folderForFile(fileName);
  if (!fileName || !folderId) {
    console.log(`[Pre-Save Cleanup] SKIP — file_name=${fileName}, folderId=${folderId}`);
    continue;
  }

  // Build query — Drive uses backslash-escape for single quotes inside literals
  const escapedName = fileName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${escapedName}' and '${folderId}' in parents and trashed = false`;

  let listResp;
  try {
    listResp = await this.helpers.httpRequestWithAuthentication.call(this, 'googleDriveOAuth2Api', {
      method: 'GET',
      url: 'https://www.googleapis.com/drive/v3/files',
      qs: {
        q,
        fields: 'files(id,name,parents)',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
      json: true,
    });
  } catch (e) {
    searchErrors++;
    console.error(`[Pre-Save Cleanup] SEARCH FAILED for "${fileName}" — ${e.message}`);
    console.error(`  query: ${q}`);
    if (e.response) console.error(`  status: ${e.response?.statusCode || e.statusCode}, body: ${JSON.stringify(e.response?.body || e.body || {}).slice(0,300)}`);
    continue;
  }

  const existing = listResp.files || [];
  console.log(`[Pre-Save Cleanup] "${fileName}" — search returned ${existing.length} matches`);

  if (existing.length === 0) {
    zeroMatches++;
    console.log(`  zero matches — was looking in folder ${folderId} for name="${fileName}"`);
    continue;
  }

  for (const f of existing) {
    try {
      await this.helpers.httpRequestWithAuthentication.call(this, 'googleDriveOAuth2Api', {
        method: 'DELETE',
        url: `https://www.googleapis.com/drive/v3/files/${f.id}`,
        qs: { supportsAllDrives: true },
      });
      deleted++;
      console.log(`[Pre-Save Cleanup] DELETED ${fileName} (id=${f.id})`);
    } catch (e) {
      deleteErrors++;
      console.error(`[Pre-Save Cleanup] DELETE FAILED for ${fileName} (id=${f.id}) — ${e.message}`);
      if (e.response) console.error(`  status: ${e.response?.statusCode || e.statusCode}`);
    }
  }
}

console.log(`[Pre-Save Cleanup] DONE — deleted=${deleted}, zeroMatches=${zeroMatches}, searchErrors=${searchErrors}, deleteErrors=${deleteErrors}`);
return items;
