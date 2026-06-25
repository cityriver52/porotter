/**
 * Read snapshots shared by API-facing services.
 */

function createReadSnapshot_() {
  return {
    posts: readRecords_(CONFIG_.SHEETS.POSTS),
    replies: readRecords_(CONFIG_.SHEETS.REPLIES),
    settings: readSettings_(),
    personas: readRecords_(CONFIG_.SHEETS.PERSONAS)
  };
}
