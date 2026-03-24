/**
 * Vercel Serverless Function – /api/log
 *
 * GET  /api/log?type=fridge   → returns fridge_log CSV rows as JSON array
 * GET  /api/log?type=audit    → returns audit_log CSV rows as JSON array
 * GET  /api/log               → returns { fridge: [...], audit: [...] }
 *
 * POST /api/log  { type: "fridge", rows: [ {...} ] }
 *                { type: "audit",  rows: [ {...} ], overall_comments: "..." }
 *   → appends rows to the corresponding CSV in the GitHub repo
 *
 * Requires env vars:  GITHUB_TOKEN, GITHUB_REPO (e.g. "MagicManBen/Scanner")
 */

const FRIDGE_PATH = "logs/fridge_log.csv";
const AUDIT_PATH  = "logs/audit_log.csv";

const FRIDGE_HEADERS = [
  "Fridge","Date","Time","Current Temp (°C)","Min Temp (°C)",
  "Max Temp (°C)","Thermometer Reset","Comments","Checked By"
];

const AUDIT_HEADERS = [
  "Date","Time","Audit Timestamp","Item ID","Item Name","Room","Matched",
  "Date Checked","Stock Checked","Cleaned","Item Comment","Overall Comments"
];

/* ---- helpers ---- */
function csvEscape(v) {
  if (v == null) return "";
  var s = String(v);
  if (s.indexOf(",") >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(arr) { return arr.map(csvEscape).join(","); }

function parseCsv(text) {
  // Simple CSV parser (handles quoted fields)
  if (!text || !text.trim()) return [];
  var lines = [], row = [], field = "", inQuote = false;
  for (var i = 0; i < text.length; i++) {
    var c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else { field += c; }
    } else {
      if (c === '"') { inQuote = true; }
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") lines.push(row);
        row = [];
      } else { field += c; }
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") lines.push(row);
  return lines;
}

function csvToJson(text) {
  var lines = parseCsv(text);
  if (lines.length === 0) return [];
  var headers = lines[0];
  var result = [];
  for (var i = 1; i < lines.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = (lines[i][j] || "");
    }
    result.push(obj);
  }
  return result;
}

async function ghGet(repo, path, token) {
  var url = `https://api.github.com/repos/${repo}/contents/${path}`;
  var res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" }
  });
  if (res.status === 404) return { exists: false, sha: null, content: "" };
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status} ${await res.text()}`);
  var data = await res.json();
  var decoded = Buffer.from(data.content, "base64").toString("utf-8");
  return { exists: true, sha: data.sha, content: decoded };
}

async function ghPut(repo, path, token, content, sha, message) {
  var url = `https://api.github.com/repos/${repo}/contents/${path}`;
  var body = {
    message: message || `Update ${path}`,
    content: Buffer.from(content, "utf-8").toString("base64")
  };
  if (sha) body.sha = sha;
  var res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub PUT ${path}: ${res.status} ${await res.text()}`);
  return await res.json();
}

/* ---- handler ---- */
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  var token = process.env.GITHUB_TOKEN;
  var repo  = process.env.GITHUB_REPO || "MagicManBen/Scanner";
  if (!token) return res.status(500).json({ error: "GITHUB_TOKEN not configured" });

  try {
    /* ---- GET: return logs as JSON ---- */
    if (req.method === "GET") {
      var type = req.query.type;
      if (type === "fridge") {
        var f = await ghGet(repo, FRIDGE_PATH, token);
        return res.status(200).json(csvToJson(f.content));
      }
      if (type === "audit") {
        var a = await ghGet(repo, AUDIT_PATH, token);
        return res.status(200).json(csvToJson(a.content));
      }
      // Both
      var ff = await ghGet(repo, FRIDGE_PATH, token);
      var aa = await ghGet(repo, AUDIT_PATH, token);
      return res.status(200).json({
        fridge: csvToJson(ff.content),
        audit:  csvToJson(aa.content)
      });
    }

    /* ---- POST: append rows ---- */
    if (req.method === "POST") {
      var body = req.body;
      if (!body || !body.type) return res.status(400).json({ error: "type required" });

      if (body.type === "fridge") {
        var rows = body.rows;
        if (!rows || !rows.length) return res.status(400).json({ error: "rows required" });

        var file = await ghGet(repo, FRIDGE_PATH, token);
        var csv = file.exists ? file.content : (csvRow(FRIDGE_HEADERS) + "\n");
        // Ensure trailing newline
        if (!csv.endsWith("\n")) csv += "\n";

        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          csv += csvRow([
            r.fridge || "", r.date || "", r.time || "",
            r.current_temp || "", r.min_temp || "", r.max_temp || "",
            r.thermometer_reset || "", r.comments || "", r.checked_by || ""
          ]) + "\n";
        }

        await ghPut(repo, FRIDGE_PATH, token, csv, file.sha || null,
          "Log fridge check " + (rows[0].date || ""));
        return res.status(200).json({ ok: true, rows_added: rows.length });
      }

      if (body.type === "audit") {
        var items = body.rows;
        if (!items || !items.length) return res.status(400).json({ error: "rows required" });
        var overall = body.overall_comments || "";

        var file = await ghGet(repo, AUDIT_PATH, token);
        var csv = file.exists ? file.content : (csvRow(AUDIT_HEADERS) + "\n");
        if (!csv.endsWith("\n")) csv += "\n";

        for (var j = 0; j < items.length; j++) {
          var it = items[j];
          csv += csvRow([
            it.date || "", it.time || "", it.timestamp || "",
            it.item_id || "", it.item_name || "", it.room || "", it.matched || "",
            it.date_checked || "", it.stock_checked || "", it.cleaned || "",
            it.item_comment || "", overall
          ]) + "\n";
        }

        await ghPut(repo, AUDIT_PATH, token, csv, file.sha || null,
          "Log room audit " + (items[0].date || ""));
        return res.status(200).json({ ok: true, rows_added: items.length });
      }

      return res.status(400).json({ error: "type must be 'fridge' or 'audit'" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("log API error:", err);
    return res.status(500).json({ error: err.message });
  }
}
