import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

for (const filename of fs.readdirSync(root).filter(name => name.endsWith('.gs'))) {
  try {
    new vm.Script(fs.readFileSync(path.join(root, filename), 'utf8'), { filename });
  } catch (error) {
    errors.push(`${filename}: ${error.message}`);
  }
}

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  if (manifest.addOns) errors.push('appsscript.json: custom Workspace Studio steps must not be configured');
  if (!manifest.oauthScopes?.includes('https://www.googleapis.com/auth/script.scriptapp')) {
    errors.push('appsscript.json: trigger management scope is missing');
  }
  if (manifest.webapp?.access !== 'MYSELF') {
    errors.push('appsscript.json: first-time web setup requires MYSELF access');
  }
} catch (error) {
  errors.push(`appsscript.json: ${error.message}`);
}

const clientFile = fs.readFileSync(path.join(root, 'JavaScript.html'), 'utf8');
const clientScript = clientFile.replace(/^\s*<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
try {
  new vm.Script(clientScript, { filename: 'JavaScript.html' });
} catch (error) {
  errors.push(`JavaScript.html: ${error.message}`);
}

const index = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
for (const partial of ['Styles', 'JavaScript']) {
  if (!index.includes(`include_('${partial}')`)) errors.push(`Index.html: ${partial} partial is not included`);
}

const ids = Array.from(index.matchAll(/\bid="([^"]+)"/g), match => match[1]);
const duplicateIds = ids.filter((id, indexOfId) => ids.indexOf(id) !== indexOfId);
if (duplicateIds.length) errors.push(`Index.html: duplicate IDs: ${[...new Set(duplicateIds)].join(', ')}`);
const referencedIds = Array.from(clientFile.matchAll(/queryOne\(['"]#([A-Za-z0-9_-]+)['"]/g), match => match[1]);
const missingReferencedIds = [...new Set(referencedIds.filter(id => !ids.includes(id)))];
if (missingReferencedIds.length) errors.push(`JavaScript.html references missing DOM IDs: ${missingReferencedIds.join(', ')}`);

const timelineView = index.slice(index.indexOf('id="timeline-view"'), index.indexOf('id="search-view"'));
const searchView = index.slice(index.indexOf('id="search-view"'), index.indexOf('id="trash-view"'));
if (timelineView.includes('id="filter-form"')) errors.push('Index.html: search form must not be inside the home timeline view');
if (!searchView.includes('id="filter-form"') || !searchView.includes('id="search-timeline"')) {
  errors.push('Index.html: dedicated search view is incomplete');
}
if (!index.includes('data-persona-template') || !clientFile.includes("callApi('apiSavePersona'")) {
  errors.push('Persona management UI is incomplete');
}
if (!index.includes('id="daily-prompt"') || !index.includes('id="refresh-prompt"') || !clientFile.includes('const DAILY_PROMPTS')) {
  errors.push("Today's Prompt randomization UI is incomplete");
}
if (!clientFile.includes("reply.authorType === 'persona'") || !clientFile.includes('reply.parentReplyId') || !clientFile.includes('nested-reply')) {
  errors.push('AI reply attribution UI is incomplete');
}
if (!clientFile.includes('threadOpenable: true') || !clientFile.includes('timelinePostIdFromEvent') || !clientFile.includes('handleTimelineKeydown')) {
  errors.push('Post-card thread navigation is incomplete');
}
const studioFile = fs.readFileSync(path.join(root, 'Studio.gs'), 'utf8');
for (const requiredContext of ['Google Drive', 'Gmail', 'Google Chat', 'フォローしていないスレッド', 'フォロー状態を確認できない返信']) {
  if (!studioFile.includes(requiredContext)) errors.push(`Studio.gs: Workspace context rule is missing: ${requiredContext}`);
}
for (const requiredUi of ['id="setup-screen"', 'data-view="mine"', 'data-view="notifications"', 'id="manual-ai-post-button"', 'id="ai-post-frequency-input"', 'id="ai-reply-frequency-input"']) {
  if (!index.includes(requiredUi)) errors.push(`Index.html: required web UI is missing: ${requiredUi}`);
}
for (const requiredUi of ['id="post-source-url"', 'id="edit-source-url"']) {
  if (!index.includes(requiredUi)) errors.push(`Index.html: reference-link UI is missing: ${requiredUi}`);
}
if (index.includes('id="ai-request-status"') || clientFile.includes('AI投稿の実行履歴')) {
  errors.push('Manual AI request history should not be rendered in settings');
}
for (const requiredClient of ["callApi('apiSetupPorotter'", "callApi('apiNotifications'", "callApi('apiRequestAiPost'"]) {
  if (!clientFile.includes(requiredClient)) errors.push(`JavaScript.html: required API integration is missing: ${requiredClient}`);
}
const automationSource = fs.readdirSync(root)
  .filter(name => name.endsWith('.gs'))
  .map(name => fs.readFileSync(path.join(root, name), 'utf8'))
  .join('\n');
for (const requiredToken of ['AI_REQUEST_STATUS.REQUESTED', 'AI_REQUEST_STATUS.GENERATED', 'AI_REQUEST_STATUS.PUBLISHED', 'everyMinutes(10)']) {
  if (!automationSource.includes(requiredToken)) errors.push(`AI automation sources are incomplete: ${requiredToken}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Static checks passed (${fs.readdirSync(root).filter(name => name.endsWith('.gs')).length} server files, ${ids.length} DOM IDs).`);
