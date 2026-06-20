import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  getValues() {
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
      )
    );
  }
  setValues(values) {
    values.forEach((sourceRow, rowOffset) => sourceRow.forEach((value, columnOffset) => {
      const rowIndex = this.row - 1 + rowOffset;
      const columnIndex = this.column - 1 + columnOffset;
      while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
      this.sheet.rows[rowIndex][columnIndex] = value;
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.reduce((last, row, index) => row.some(cell => cell !== '') ? index + 1 : last, 0); }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getRange(row, column, rowCount, columnCount) { return new FakeRange(this, row, column, rowCount, columnCount); }
  appendRow(row) { this.rows.push([...row]); }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(id, name) { this.id = id; this.name = name; this.sheets = [new FakeSheet('Sheet1')]; }
  getId() { return this.id; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }
  getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name); this.sheets.push(sheet); return sheet; }
  deleteSheet(sheet) { this.sheets = this.sheets.filter(item => item !== sheet); }
  getSheets() { return this.sheets; }
}

function createContext() {
  const propertyMap = new Map();
  const spreadsheets = new Map();
  let spreadsheetSequence = 0;
  let uuidSequence = 0;
  let activeEmail = 'owner@example.com';
  const scriptProperties = {
    getProperty: key => propertyMap.get(key) || null,
    setProperty: (key, value) => propertyMap.set(key, String(value))
  };
  const user = () => ({ getEmail: () => activeEmail });

  const context = vm.createContext({
    console,
    Date,
    JSON,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    PropertiesService: { getScriptProperties: () => scriptProperties },
    SpreadsheetApp: {
      create: name => {
        const spreadsheet = new FakeSpreadsheet(`sheet-${++spreadsheetSequence}`, name);
        spreadsheets.set(spreadsheet.id, spreadsheet);
        return spreadsheet;
      },
      openById: id => spreadsheets.get(id)
    },
    Session: {
      getEffectiveUser: user,
      getActiveUser: user,
      getScriptTimeZone: () => 'Asia/Tokyo'
    },
    Utilities: {
      getUuid: () => `uuid-${++uuidSequence}`,
      formatDate: (date, _timeZone, format) => {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(date)).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
        if (format === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
        if (format === 'MM-dd') return `${parts.month}-${parts.day}`;
        if (format === 'yyyy') return parts.year;
        throw new Error(`Unsupported format: ${format}`);
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    HtmlService: {
      XFrameOptionsMode: { SAMEORIGIN: 'SAMEORIGIN' },
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    }
  });
  context.__setActiveEmail = value => { activeEmail = value; };

  for (const file of ['Config.gs', 'Repository.gs', 'Api.gs', 'Code.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('setup, CRUD, replies, trash, search and export work as one flow', () => {
  const app = createContext();
  const setup = app.setupMySNS();
  assert.equal(setup.allowedEmail, 'owner@example.com');
  assert.equal(app.checkMySNSSetup().configured, true);

  const first = app.apiCreatePost({ body: '<script>alert(1)</script> 気づき', tags: ['学び', '#違和感'] });
  assert.equal(first.ok, true);
  assert.deepEqual(Array.from(first.data.tags), ['学び', '違和感']);

  const second = app.apiCreatePost({ body: '=SUM(A1:A2)', tags: ['アイデア'] });
  assert.equal(second.ok, true);

  let timeline = app.apiTimeline({ query: '気づき' });
  assert.equal(timeline.data.total, 1);
  assert.equal(timeline.data.posts[0].body, '<script>alert(1)</script> 気づき');

  const favorite = app.apiToggleFavorite(first.data.id);
  assert.equal(favorite.data.favorite, true);
  timeline = app.apiTimeline({ favoriteOnly: true });
  assert.equal(timeline.data.total, 1);

  const reply = app.apiCreateReply(first.data.id, { body: '翌日の追記' });
  assert.equal(reply.ok, true);
  let thread = app.apiThread(first.data.id);
  assert.equal(thread.data.replies.length, 1);
  assert.equal(thread.data.post.replyCount, 1);

  const updated = app.apiUpdatePost(first.data.id, { body: '更新した本文', tags: ['学び'] });
  assert.equal(updated.data.body, '更新した本文');

  assert.equal(app.apiDeletePost(first.data.id).ok, true);
  assert.equal(app.apiTrash().data.posts.length, 1);
  assert.equal(app.apiThread(first.data.id).ok, false);
  assert.equal(app.apiRestorePost(first.data.id).ok, true);
  assert.equal(app.apiThread(first.data.id).data.replies.length, 1);

  const jsonExport = app.apiExport('json');
  assert.equal(jsonExport.ok, true);
  assert.match(jsonExport.data.content, /更新した本文/);
  const csvExport = app.apiExport('csv');
  assert.match(csvExport.data.content, /"'=SUM\(A1:A2\)"/);
});

test('validation and authorization are enforced on the server', () => {
  const app = createContext();
  app.setupMySNS();

  assert.equal(app.apiCreatePost({ body: '   ', tags: [] }).ok, false);
  assert.equal(app.apiCreatePost({ body: 'x'.repeat(281), tags: [] }).ok, false);
  assert.equal(app.apiCreatePost({ body: 'valid', tags: ['1', '2', '3', '4', '5', '6'] }).ok, false);

  app.__setActiveEmail('intruder@example.com');
  const denied = app.apiTimeline({});
  assert.equal(denied.ok, false);
  assert.match(denied.error, /権限/);
});
