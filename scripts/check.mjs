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
  const workflowElements = manifest.addOns?.flows?.workflowElements || [];
  if (workflowElements.length !== 2) errors.push('appsscript.json: expected 2 Workspace Studio custom steps');
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

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`Static checks passed (${fs.readdirSync(root).filter(name => name.endsWith('.gs')).length} server files, ${ids.length} DOM IDs).`);
