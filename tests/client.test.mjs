import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = fs.readFileSync(path.join(root, 'JavaScript.html'), 'utf8');
const start = client.indexOf('  function formatBody(value)');
const end = client.indexOf('  function formatRelativeDate(value)');

if (start < 0 || end < 0) throw new Error('URL formatting helpers were not found.');

const context = vm.createContext({});
vm.runInContext(`${client.slice(start, end)}\nthis.formatBody = formatBody;`, context);

const promptStart = client.indexOf('  function chooseDailyPrompt(prompts, currentId, randomValue)');
const promptEnd = client.indexOf('  function renderDailyPrompt()');
if (promptStart < 0 || promptEnd < 0) throw new Error('Daily prompt selector was not found.');
vm.runInContext(`${client.slice(promptStart, promptEnd)}\nthis.chooseDailyPrompt = chooseDailyPrompt;`, context);

const tagStart = client.indexOf('  function parseTagInput(value)');
const tagEnd = client.indexOf('  function tagAutocompleteConfig(mode)');
if (tagStart < 0 || tagEnd < 0) throw new Error('Tag autocomplete helpers were not found.');
vm.runInContext(`${client.slice(tagStart, tagEnd)}\nthis.parseTagInput = parseTagInput; this.normalizeSingleTag = normalizeSingleTag; this.currentTagFragment = currentTagFragment; this.replaceCurrentTag = replaceCurrentTag; this.matchingTags = matchingTags;`, context);

const timelineTargetStart = client.indexOf('  function timelinePostIdFromEvent(event)');
const timelineTargetEnd = client.indexOf('  function handleTimelineKeydown(event)');
if (timelineTargetStart < 0 || timelineTargetEnd < 0) throw new Error('Post-card thread navigation helper was not found.');
vm.runInContext(`${client.slice(timelineTargetStart, timelineTargetEnd)}\nthis.timelinePostIdFromEvent = timelinePostIdFromEvent;`, context);

test('formatBody converts http and www URLs into safe links', () => {
  const html = context.formatBody('確認 https://example.com/path?a=1&b=2。 www.openai.com も。');

  assert.match(html, /href="https:\/\/example\.com\/path\?a=1&amp;b=2"/);
  assert.match(html, />https:\/\/example\.com\/path\?a=1&amp;b=2<\/a>。/);
  assert.match(html, /href="https:\/\/www\.openai\.com"/);
  assert.match(html, />www\.openai\.com<\/a>/);
  assert.equal((html.match(/class="post-link"/g) || []).length, 2);
  assert.equal((html.match(/target="_blank"/g) || []).length, 2);
  assert.equal((html.match(/rel="noopener noreferrer nofollow"/g) || []).length, 2);
});

test('formatBody escapes HTML and keeps trailing punctuation outside links', () => {
  const html = context.formatBody('<script>alert(1)</script>\n(https://example.com/test)');

  assert.ok(html.startsWith('&lt;script&gt;alert(1)&lt;/script&gt;<br>('));
  assert.match(html, /href="https:\/\/example\.com\/test"[^>]*>https:\/\/example\.com\/test<\/a>\)$/);
  assert.doesNotMatch(html, /<script>/);
});

test('daily prompts contain varied work-reflection questions', () => {
  const promptIds = Array.from(client.matchAll(/\{ id: '([^']+)', question:/g), match => match[1]);
  assert.ok(promptIds.length >= 10);
  assert.equal(new Set(promptIds).size, promptIds.length);
  assert.match(client, /仕事の見方/);
  assert.match(client, /違和感/);
  assert.match(client, /明日の自分/);
});

test('daily prompt selection is randomizable and avoids the current question', () => {
  const prompts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(context.chooseDailyPrompt(prompts, 'a', 0).id, 'b');
  assert.equal(context.chooseDailyPrompt(prompts, 'a', 0.999999).id, 'c');
  assert.equal(context.chooseDailyPrompt([{ id: 'only' }], 'only', 0.5).id, 'only');
  assert.equal(context.chooseDailyPrompt([], '', 0.5), null);
});

test('tag input accepts new tags and replaces only the current tag', () => {
  assert.deepEqual(Array.from(context.parseTagInput('#学び 新しいタグ #学び')), ['学び', '新しいタグ']);
  assert.equal(context.normalizeSingleTag('#自由入力'), '自由入力');
  assert.equal(context.currentTagFragment('#学び #違', true), '違');
  assert.equal(context.replaceCurrentTag('#学び #違', '違和感', true), '#学び #違和感 ');
  assert.equal(context.replaceCurrentTag('学', '学び', false), '#学び');
});

test('tag suggestions match existing tags by text and prefer prefix matches', () => {
  const tags = [
    { name: '改善メモ', count: 2 },
    { name: '業務改善', count: 9 },
    { name: '学び', count: 5 }
  ];
  const matches = Array.from(context.matchingTags(tags, '改善', []), tag => tag.name);
  assert.deepEqual(matches, ['改善メモ', '業務改善']);
  assert.deepEqual(Array.from(context.matchingTags(tags, '', ['学び']), tag => tag.name), ['業務改善', '改善メモ']);
});

test('post-card clicks open threads but interactive controls keep their own action', () => {
  const post = { dataset: { postId: 'post-123' } };
  const cardTarget = { closest: selector => selector.startsWith('a, button') ? null : post };
  const linkTarget = { closest: selector => selector.startsWith('a, button') ? {} : post };

  assert.equal(context.timelinePostIdFromEvent({ target: cardTarget }), 'post-123');
  assert.equal(context.timelinePostIdFromEvent({ target: linkTarget }), '');
  assert.equal(context.timelinePostIdFromEvent({ target: null }), '');
});
