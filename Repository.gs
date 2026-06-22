function getSpreadsheet_() {
  migrateLegacyProperties_();
  const id = PropertiesService.getScriptProperties().getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
  if (!id) {
    throw new Error('保存先が設定されていません。setupPorotter を実行してください。');
  }
  const spreadsheet = SpreadsheetApp.openById(id);
  if (spreadsheet.getName && spreadsheet.getName() !== CONFIG_.SPREADSHEET_NAME) {
    spreadsheet.setName(CONFIG_.SPREADSHEET_NAME);
  }
  return spreadsheet;
}

function ensureSchema_(spreadsheet) {
  Object.keys(CONFIG_.SHEETS).forEach(function (key) {
    const definition = CONFIG_.SHEETS[key];
    let sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) sheet = spreadsheet.insertSheet(definition.name);

    const headers = definition.headers.slice();
    const currentHeaders = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
      : [];

    headers.forEach(function (header, index) {
      if (currentHeaders[index] && currentHeaders[index] !== header) {
        throw new Error(definition.name + ' シートの列構成が想定と異なります。');
      }
    });

    const headersNeedWrite = headers.some(function (header, index) {
      return currentHeaders[index] !== header;
    });
    if (headersNeedWrite) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length)
        .setFontWeight('bold')
        .setBackground('#e8f3ff');
    }
  });

  const defaultSheet = spreadsheet.getSheetByName('シート1') || spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > Object.keys(CONFIG_.SHEETS).length && defaultSheet.getLastRow() === 0) {
    spreadsheet.deleteSheet(defaultSheet);
  }
}

function getSheet_(sheetName) {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    ensureSchema_(spreadsheet);
    return spreadsheet.getSheetByName(sheetName);
  }
  return sheet;
}

function readRecords_(definition) {
  const sheet = getSheet_(definition.name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const headers = definition.headers.slice();
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row, rowIndex) {
    return recordFromRow_(headers, row, rowIndex + 2);
  });
}

function recordFromRow_(headers, row, rowNumber) {
  const record = { _row: rowNumber };
  headers.forEach(function (header, columnIndex) {
    const value = row[columnIndex];
    record[header] = value instanceof Date ? value.toISOString() : value;
  });
  return record;
}

function appendRecord_(definition, record) {
  const sheet = getSheet_(definition.name);
  const row = definition.headers.map(function (header) {
    return record[header] == null ? '' : record[header];
  });
  sheet.appendRow(row);
  return record;
}

function findRecordById_(definition, id) {
  const sheet = getSheet_(definition.name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('対象のデータが見つかりません。');

  const idRange = sheet.getRange(2, 1, lastRow - 1, 1);
  if (idRange.createTextFinder) {
    const found = idRange.createTextFinder(String(id)).matchEntireCell(true).findNext();
    if (!found) throw new Error('対象のデータが見つかりません。');
    const rowNumber = found.getRow();
    const row = sheet.getRange(rowNumber, 1, 1, definition.headers.length).getValues()[0];
    return recordFromRow_(definition.headers, row, rowNumber);
  }

  const record = readRecords_(definition).find(function (item) {
    return String(item.id) === String(id);
  });
  if (!record) throw new Error('対象のデータが見つかりません。');
  return record;
}

function patchRecord_(definition, rowNumber, patch) {
  const sheet = getSheet_(definition.name);
  const headers = definition.headers;
  const keys = Object.keys(patch).filter(function (key) {
    return headers.indexOf(key) >= 0;
  });
  if (!keys.length) return;
  if (keys.length === 1) {
    const column = headers.indexOf(keys[0]);
    sheet.getRange(rowNumber, column + 1).setValue(patch[keys[0]]);
    return;
  }

  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const row = range.getValues()[0];
  keys.forEach(function (key) {
    row[headers.indexOf(key)] = patch[key];
  });
  range.setValues([row]);
}

function deleteRecordRow_(definition, rowNumber) {
  getSheet_(definition.name).deleteRow(rowNumber);
}

function readSettings_() {
  const records = readRecords_(CONFIG_.SHEETS.SETTINGS);
  return records.reduce(function (result, record) {
    result[String(record.key)] = String(record.value == null ? '' : record.value);
    return result;
  }, {});
}

function writeSettings_(updates) {
  const definition = CONFIG_.SHEETS.SETTINGS;
  const existingByKey = readRecords_(definition).reduce(function (records, record) {
    records[String(record.key)] = record;
    return records;
  }, {});
  const timestamp = nowIso_();

  Object.keys(updates).forEach(function (key) {
    const existing = existingByKey[key];
    const value = String(updates[key]);
    if (existing) {
      patchRecord_(definition, existing._row, { value: value, updatedAt: timestamp });
    } else {
      appendRecord_(definition, { key: key, value: value, updatedAt: timestamp });
    }
  });
}

function ensureDefaultSettings_(email) {
  const settings = readSettings_();
  const defaults = {};
  if (!settings.displayName) defaults.displayName = email.split('@')[0];
  if (!settings.theme) defaults.theme = 'system';
  if (!settings.pageSize) defaults.pageSize = String(CONFIG_.DEFAULT_PAGE_SIZE);
  if (settings.aiPostIntervalHours === undefined) {
    defaults.aiPostIntervalHours = String(CONFIG_.DEFAULT_AI_POST_INTERVAL_HOURS);
  }
  if (settings.aiReplyIntervalHours === undefined) {
    defaults.aiReplyIntervalHours = String(CONFIG_.DEFAULT_AI_REPLY_INTERVAL_HOURS);
  }
  if (!settings.notificationsReadAt) defaults.notificationsReadAt = nowIso_();
  if (Object.keys(defaults).length) writeSettings_(defaults);
}
