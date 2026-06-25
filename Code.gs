/**
 * ぽろったー web application entry points.
 */
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG_.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function include_(filename) {
  return HtmlService.createTemplateFromFile(filename).getRawContent();
}

/**
 * Run this once from the Apps Script editor before deploying the web app.
 * The effective user's email becomes the sole allowed account.
 */
function setupPorotter() {
  migrateLegacyProperties_();
  const email = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!email) {
    throw new Error('Google Workspace のアカウントで setupPorotter を実行してください。');
  }

  return withScriptLock_(function () {
    return setupPorotterForEmail_(email);
  });
}

function setupPorotterForEmail_(email) {
  const normalizedEmail = normalizeEmail_(email);
  if (!normalizedEmail) throw new Error('ログイン中のGoogleアカウントを確認できません。');

  const properties = PropertiesService.getScriptProperties();
  const existingOwner = normalizeEmail_(properties.getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL));
  if (existingOwner && existingOwner !== normalizedEmail) {
    throw new Error('このアプリは別のアカウントで初期設定済みです。');
  }
  let spreadsheetId = properties.getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
  let spreadsheet;

  if (spreadsheetId) {
    spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    if (spreadsheet.getName && spreadsheet.getName() !== CONFIG_.SPREADSHEET_NAME) {
      spreadsheet.setName(CONFIG_.SPREADSHEET_NAME);
    }
  } else {
    spreadsheet = SpreadsheetApp.create(CONFIG_.SPREADSHEET_NAME);
    spreadsheetId = spreadsheet.getId();
    properties.setProperty(CONFIG_.PROPERTY_SPREADSHEET_ID, spreadsheetId);
  }

  ensureSchema_(spreadsheet);
  properties.setProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL, normalizedEmail);
  ensureDefaultSettings_(normalizedEmail);

  return {
    allowedEmail: normalizedEmail,
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    message: 'ぽろったーの初期設定が完了しました。'
  };
}

/**
 * A safe diagnostic that intentionally does not return stored post content.
 */
function checkPorotterSetup() {
  migrateLegacyProperties_();
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(CONFIG_.PROPERTY_SPREADSHEET_ID);
  const allowedEmail = properties.getProperty(CONFIG_.PROPERTY_ALLOWED_EMAIL);

  return {
    configured: Boolean(spreadsheetId && allowedEmail),
    allowedEmail: allowedEmail || '',
    spreadsheetId: spreadsheetId || ''
  };
}
