import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function emptyMetrics() {
  return { rangeReads: 0, rowsRead: 0, cellsRead: 0, textFinds: 0, rangeWrites: 0, cellsWritten: 0 };
}

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  getValues() {
    const metrics = this.sheet.metrics;
    metrics.rangeReads += 1;
    metrics.rowsRead += this.rowCount;
    metrics.cellsRead += this.rowCount * this.columnCount;
    return Array.from({ length: this.rowCount }, (_, rowOffset) =>
      Array.from({ length: this.columnCount }, (_, columnOffset) =>
        this.sheet.rows[this.row - 1 + rowOffset]?.[this.column - 1 + columnOffset] ?? ''
      )
    );
  }
  setValues(values) {
    const metrics = this.sheet.metrics;
    metrics.rangeWrites += 1;
    metrics.cellsWritten += values.reduce((sum, row) => sum + row.length, 0);
    values.forEach((sourceRow, rowOffset) => sourceRow.forEach((value, columnOffset) => {
      const rowIndex = this.row - 1 + rowOffset;
      const columnIndex = this.column - 1 + columnOffset;
      while (this.sheet.rows.length <= rowIndex) this.sheet.rows.push([]);
      this.sheet.rows[rowIndex][columnIndex] = value;
    }));
    return this;
  }
  setValue(value) { return this.setValues([[value]]); }
  getRow() { return this.row; }
  createTextFinder(searchText) {
    const range = this;
    let exact = false;
    return {
      matchEntireCell(value) { exact = value; return this; },
      findNext() {
        range.sheet.metrics.textFinds += 1;
        const search = String(searchText);
        for (let rowOffset = 0; rowOffset < range.rowCount; rowOffset += 1) {
          for (let columnOffset = 0; columnOffset < range.columnCount; columnOffset += 1) {
            const value = String(range.sheet.rows[range.row - 1 + rowOffset]?.[range.column - 1 + columnOffset] ?? '');
            if ((exact && value === search) || (!exact && value.includes(search))) {
              return new FakeRange(range.sheet, range.row + rowOffset, range.column + columnOffset);
            }
          }
        }
        return null;
      }
    };
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name, metrics) { this.name = name; this.metrics = metrics; this.rows = []; }
  getName() { return this.name; }
  getLastRow() {
    return this.rows.reduce((last, row, index) => row.some(cell => cell !== '') ? index + 1 : last, 0);
  }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
  appendRow(row) {
    this.metrics.rangeWrites += 1;
    this.metrics.cellsWritten += row.length;
    this.rows.push([...row]);
  }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor(id, name, metrics) {
    this.id = id;
    this.name = name;
    this.metrics = metrics;
    this.sheets = [new FakeSheet('Sheet1', metrics)];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(name) { this.name = name; return this; }
  getUrl() { return `https://docs.google.com/spreadsheets/d/${this.id}`; }
  getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; }
  insertSheet(name) { const sheet = new FakeSheet(name, this.metrics); this.sheets.push(sheet); return sheet; }
  deleteSheet(sheet) { this.sheets = this.sheets.filter(item => item !== sheet); }
  getSheets() { return this.sheets; }
}

export function createAppsScriptHarness(root, options = {}) {
  const metrics = emptyMetrics();
  const propertyMap = new Map();
  const spreadsheets = new Map();
  let spreadsheetSequence = 0;
  let uuidSequence = 0;
  let activeEmail = options.email || 'owner@example.com';
  const scriptProperties = {
    getProperty: key => propertyMap.get(key) || null,
    setProperty: (key, value) => propertyMap.set(key, String(value)),
    deleteProperty: key => propertyMap.delete(key)
  };
  const user = () => ({ getEmail: () => activeEmail });

  const context = vm.createContext({
    console, Date, JSON, Math, Number, String, Boolean, Array, Object, RegExp, Error,
    PropertiesService: { getScriptProperties: () => scriptProperties },
    SpreadsheetApp: {
      create: name => {
        const spreadsheet = new FakeSpreadsheet(`sheet-${++spreadsheetSequence}`, name, metrics);
        spreadsheets.set(spreadsheet.id, spreadsheet);
        return spreadsheet;
      },
      openById: id => spreadsheets.get(id)
    },
    Session: { getEffectiveUser: user, getActiveUser: user, getScriptTimeZone: () => 'Asia/Tokyo' },
    Utilities: {
      getUuid: () => `uuid-${++uuidSequence}`,
      formatDate: (date, _timeZone, format) => {
        const value = new Date(date);
        const parts = options.fastDates
          ? {
              year: String(value.getUTCFullYear()),
              month: String(value.getUTCMonth() + 1).padStart(2, '0'),
              day: String(value.getUTCDate()).padStart(2, '0')
            }
          : new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
            }).formatToParts(value).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
        if (format === 'yyyy-MM-dd') return `${parts.year}-${parts.month}-${parts.day}`;
        if (format === 'MM-dd') return `${parts.month}-${parts.day}`;
        if (format === 'yyyy') return parts.year;
        throw new Error(`Unsupported format: ${format}`);
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    HtmlService: {
      createTemplateFromFile: () => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) }),
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    },
    AddOnsResponseService: {
      newReturnOutputVariablesAction: () => ({ setVariableDataMap(map) { this.variableDataMap = map; return this; } }),
      newHostAppAction: () => ({ setWorkflowAction(action) { this.workflowAction = action; return this; } }),
      newRenderActionBuilder: () => ({ setHostAppAction(action) { this.hostAppAction = action; return this; }, build() { return { hostAppAction: this.hostAppAction }; } })
    }
  });

  for (const file of ['Config.gs', 'Repository.gs', 'Domain.gs', 'Api.gs', 'Code.gs', 'Studio.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  context.__definitions = vm.runInContext('CONFIG_.SHEETS', context);
  context.__setActiveEmail = value => { activeEmail = value; };

  return {
    context,
    get spreadsheet() { return spreadsheets.values().next().value; },
    resetMetrics() { Object.assign(metrics, emptyMetrics()); },
    metrics: () => ({ ...metrics })
  };
}
