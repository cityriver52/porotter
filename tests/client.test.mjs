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
