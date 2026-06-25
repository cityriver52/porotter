/**
 * Read snapshots shared by API-facing services.
 */

function createReadSnapshot_() {
  const entries = readRecords_(CONFIG_.SHEETS.ENTRIES);
  return {
    entries: entries,
    posts: entries.filter(function (entry) { return !entry.parentId; }),
    replies: entries.filter(function (entry) { return entry.parentId; }),
    settings: readSettings_(),
    personas: readRecords_(CONFIG_.SHEETS.PERSONAS)
  };
}
