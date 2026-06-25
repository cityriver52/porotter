import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createAppsScriptHarness } from '../tests/helpers/apps-script-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sizes = process.argv.includes('--quick')
  ? [100, 1000, 5000]
  : [100, 1000, 5000, 10000, 20000, 50000];
const iterations = process.argv.includes('--quick') ? 3 : 5;

function rowFor(headers, record) {
  return headers.map(header => record[header] ?? '');
}

function seed(harness, postCount) {
  const { context, spreadsheet } = harness;
  const entriesDefinition = context.__definitions.ENTRIES;
  const entries = spreadsheet.getSheetByName(entriesDefinition.name);
  const baseTime = Date.parse('2025-01-01T00:00:00.000Z');

  entries.rows = [Array.from(entriesDefinition.headers)];
  for (let index = 0; index < postCount; index += 1) {
    const id = `post-${index}`;
    const timestamp = new Date(baseTime + index * 60_000).toISOString();
    entries.rows.push(rowFor(entriesDefinition.headers, {
      id,
      body: index % 97 === 0 ? `検討対象 needle ${index}` : `仕事の気づき ${index}`,
      tags: JSON.stringify(index % 3 === 0 ? ['学び', '改善'] : ['記録']),
      createdAt: timestamp,
      updatedAt: timestamp,
      favorite: index % 20 === 0,
      deletedAt: index % 100 === 99 ? timestamp : '',
      authorEmail: 'owner@example.com',
      authorType: 'user',
      authorId: 'owner@example.com',
      parentId: '',
      rootId: id
    }));
    if (index % 4 === 0) {
      entries.rows.push(rowFor(entriesDefinition.headers, {
        id: `reply-${index}`,
        body: `追記 ${index}`,
        tags: '[]',
        createdAt: timestamp,
        updatedAt: timestamp,
        favorite: false,
        deletedAt: '',
        authorEmail: 'owner@example.com',
        authorType: 'user',
        authorId: 'owner@example.com',
        parentId: id,
        rootId: id
      }));
    }
  }
}

function measure(harness, operation) {
  operation();
  const runs = [];
  for (let index = 0; index < iterations; index += 1) {
    harness.resetMetrics();
    const startedAt = performance.now();
    const result = operation();
    runs.push({ duration: performance.now() - startedAt, metrics: harness.metrics() });
    if (!result?.ok) throw new Error(result?.error || 'Benchmark operation failed');
  }
  const middle = runs.sort((a, b) => a.duration - b.duration)[Math.floor(runs.length / 2)];
  return { ms: Number(middle.duration.toFixed(2)), ...middle.metrics };
}

const results = [];
for (const size of sizes) {
  const harness = createAppsScriptHarness(root, { fastDates: true });
  harness.context.setupPorotter();
  seed(harness, size);
  const targetId = `post-${Math.floor(size / 2)}`;
  const operations = {
    bootstrap: () => harness.context.apiBootstrap({}),
    timeline: () => harness.context.apiTimeline({}),
    search: () => harness.context.apiTimeline({ query: 'needle' }),
    favorite: () => harness.context.apiToggleFavorite(targetId)
  };
  for (const [operation, run] of Object.entries(operations)) {
    results.push({ posts: size, operation, ...measure(harness, run) });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ iterations, results }, null, 2));
} else {
  console.table(results);
  console.log(`Median of ${iterations} runs. Timings are local CPU simulation; read volumes reflect the real GAS code path.`);
}
