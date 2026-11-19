/**
 * Receives ratings from the HAUNT line-review page and writes them to this Google Sheet, one tab per element.
 * Each reviewer has one row per line: rating again and the row is updated, not duplicated.
 *
 * Setup: see README.md ("Connect the Google Sheet"). Paste this file into Extensions → Apps Script of the sheet,
 * then Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).
 */

const HEADER = ["updated", "reviewer", "element", "line", "center (A)", "species", "rating", "comment"];
const COL = { reviewer: 2, center: 5 };   // 1-based columns used to find a reviewer's existing row

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);                   // one write at a time, so two reviewers can't clash
  try {
    const data = JSON.parse(e.postData.contents);
    const reviewer = String(data.reviewer || "").trim();
    const element = cleanElement(data.element);
    if (!reviewer || !element) return reply({ ok: false, error: "missing reviewer or element" });

    const sheet = elementSheet(element);
    const index = rowIndex(sheet);        // "reviewer|center" -> row number
    const now = new Date();
    const appends = [];
    (data.ratings || []).forEach(function (r) {
      const center = Number(r.center);
      const row = [now, reviewer, element, Number(r.window) || "", center, String(r.species || ""),
                   String(r.rating || ""), String(r.comment || "")];
      const key = rowKey(reviewer, center);
      if (index[key]) {
        sheet.getRange(index[key], 1, 1, HEADER.length).setValues([row]);
      } else {
        index[key] = sheet.getLastRow() + 1 + appends.length;
        appends.push(row);
      }
    });
    if (appends.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appends.length, HEADER.length).setValues(appends);
    }
    return reply({ ok: true, saved: (data.ratings || []).length });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** ?element=Zr&reviewer=Name -> that reviewer's ratings for the element (lets them continue on another computer). */
function doGet(e) {
  const p = (e && e.parameter) || {};
  const element = cleanElement(p.element);
  const reviewer = String(p.reviewer || "").trim();
  if (!element || !reviewer) return reply({ ok: true, ratings: [] });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(element);
  if (!sheet || sheet.getLastRow() < 2) return reply({ ok: true, ratings: [] });
  const want = reviewer.toLowerCase();
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADER.length).getValues();
  const ratings = rows
    .filter(function (r) { return String(r[1]).trim().toLowerCase() === want; })
    .map(function (r) { return { window: r[3], center: r[4], species: r[5], rating: r[6], comment: r[7] }; });
  return reply({ ok: true, ratings: ratings });
}

function elementSheet(element) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(element);
  if (!sheet) sheet = ss.insertSheet(element);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADER.length).setFontWeight("bold");
  }
  return sheet;
}

function rowIndex(sheet) {
  const index = {};
  const n = sheet.getLastRow() - 1;
  if (n < 1) return index;
  const reviewers = sheet.getRange(2, COL.reviewer, n, 1).getValues();
  const centers = sheet.getRange(2, COL.center, n, 1).getValues();
  for (let i = 0; i < n; i++) index[rowKey(reviewers[i][0], centers[i][0])] = i + 2;
  return index;
}

function rowKey(reviewer, center) {
  return String(reviewer).trim().toLowerCase() + "|" + Number(center).toFixed(3);
}

function cleanElement(el) {
  // element symbols only (e.g. "Zr"): also keeps anyone from creating arbitrary tabs
  const s = String(el || "").trim();
  return /^[A-Z][a-z]?$/.test(s) ? s : "";
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
