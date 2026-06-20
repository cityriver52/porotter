/**
 * mySNS web application entry points.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('mySNS')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Run this once from the Apps Script editor before deploying the web app.
 * The effective user's email becomes the sole allowed account.
 */
function setupMySNS() {
  const email = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!email) {
    throw new Error('Google Workspace のアカウントで setupMySNS を実行してください。');
  }

  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  } else {
    spreadsheet = SpreadsheetApp.create(CONFIG_.SPREADSHEET_NAME);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty(CONFIG_.PROPERTY_SPREADSHEET_ID, spreadsheetId);
  }

  properties.setProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL, email);
  ensureSchema_(spreadsheet);
  ensureDefaultSettings_(email);

  return {
    allowedEmail: email,
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    message: 'mySNS の初期設定が完了しました。'
  };
}

/**
 * A safe diagnostic that intentionally does not return stored post content.
 */
function checkMySNSSetup() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
  const allowedEmail = properties.getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL);

  return {
    configured: Boolean(spreadsheetId && allowedEmail),
    allowedEmail: allowedEmail || '',
    spreadsheetId: spreadsheetId || ''
  };
}
