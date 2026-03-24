/*
 * Google Apps Script — paste this into your Google Sheet
 *
 * SETUP:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1me1WLg0btQ6YREVcCcRjlsIZguYhnbvG3qAIapROoBo
 * 2. Go to  Extensions → Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Click  Deploy → New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Click Deploy, authorise when prompted
 * 6. Copy the Web App URL and paste it into index.html where it says GOOGLE_SCRIPT_URL
 *
 * The script creates/uses two sheets:
 *   "Room Audits"    — one row per scanned item
 *   "Fridge Checks"  — one row per fridge temp check
 */

/* ---- Sheet setup ---- */

var AUDIT_SHEET = "Room Audits";
var FRIDGE_SHEET = "Fridge Checks";

var AUDIT_HEADERS = [
  "Date", "Time", "Audit Timestamp", "Item ID", "Item Name", "Room", "Matched",
  "Date Checked", "Stock Checked", "Cleaned", "Item Comment", "Overall Comments"
];

var FRIDGE_HEADERS = [
  "Fridge", "Date", "Time", "Current Temp (°C)", "Min Temp (°C)",
  "Max Temp (°C)", "Thermometer Reset", "Comments", "Checked By"
];

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    // Bold header row
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ---- Web App entry points ---- */

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "all";

    if (action === "fridge" || action === "all") {
      var fridgeData = readSheet(FRIDGE_SHEET, FRIDGE_HEADERS);
    }
    if (action === "audit" || action === "all") {
      var auditData = readSheet(AUDIT_SHEET, AUDIT_HEADERS);
    }

    var result = {};
    if (action === "fridge") result = fridgeData;
    else if (action === "audit") result = auditData;
    else result = { fridge: fridgeData, audit: auditData };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var type = body.type;

    if (type === "fridge") {
      var sheet = getOrCreateSheet(FRIDGE_SHEET, FRIDGE_HEADERS);
      var rows = body.rows || [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        sheet.appendRow([
          r.fridge || "",
          r.date || "",
          r.time || "",
          r.current_temp || "",
          r.min_temp || "",
          r.max_temp || "",
          r.thermometer_reset || "",
          r.comments || "",
          r.checked_by || ""
        ]);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, rows_added: rows.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (type === "audit") {
      var sheet = getOrCreateSheet(AUDIT_SHEET, AUDIT_HEADERS);
      var items = body.rows || [];
      var overall = body.overall_comments || "";
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        sheet.appendRow([
          it.date || "",
          it.time || "",
          it.timestamp || "",
          it.item_id || "",
          it.item_name || "",
          it.room || "",
          it.matched || "",
          it.date_checked || "",
          it.stock_checked || "",
          it.cleaned || "",
          it.item_comment || "",
          overall
        ]);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, rows_added: items.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "type must be 'fridge' or 'audit'" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* ---- Helpers ---- */

function readSheet(sheetName, defaultHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // only header row or empty

  var headers = data[0];
  var result = [];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = data[i][j] !== undefined ? String(data[i][j]) : "";
    }
    result.push(obj);
  }
  return result;
}
