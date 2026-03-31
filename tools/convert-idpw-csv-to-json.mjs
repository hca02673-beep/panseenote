/**
 * IDPW索引データ.csv（サービス名,冊数,ページ,登録日時）→ パンセノート JSON
 */
import fs from "fs";
import path from "path";

const APP_ID = "PenseeNote";
const JSON_VERSION = "1.0";
const PLAN_CODE = "basic";
const ITEM_LIMIT = 30000;

function parseCSV(text) {
  const rows = [];
  let i = 0;
  let row = [];
  let cell = "";
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  row.push(cell);
  rows.push(row);
  while (rows.length && rows[rows.length - 1].every((c) => String(c).trim() === "")) {
    rows.pop();
  }
  return rows;
}

/** 登録日時 → YYYY-MM-DD（createdAt / updatedAt 共通） */
function toIsoDate(s) {
  const raw = String(s || "").trim();
  if (!raw) return new Date().toISOString().slice(0, 10);
  const m1 = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m1) {
    const y = m1[1];
    const mo = m1[2].padStart(2, "0");
    const d = m1[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const m2 = raw.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (m2) {
    const y = 2000 + parseInt(m2[1], 10);
    return `${y}-${m2[2]}-${m2[3]}`;
  }
  return new Date().toISOString().slice(0, 10);
}

const inputPath = process.argv[2];
const outPath =
  process.argv[3] ||
  path.join(path.dirname(inputPath || "."), "IDPW索引-panseenote.json");

if (!inputPath) {
  console.error("使い方: node convert-idpw-csv-to-json.mjs <入力.csv> [出力.json]");
  process.exit(1);
}

const absIn = path.resolve(inputPath);
const absOut = path.resolve(outPath);
const raw = fs.readFileSync(absIn, "utf8").replace(/^\uFEFF/, "");
const rows = parseCSV(raw);
if (rows.length < 2) {
  console.error("データがありません。");
  process.exit(1);
}

const headers = rows[0].map((c) => String(c).trim());
const hi = {
  title: headers.indexOf("サービス名"),
  book: headers.indexOf("冊数"),
  page: headers.indexOf("ページ"),
  date: headers.indexOf("登録日時"),
};
if (hi.title < 0 || hi.book < 0 || hi.page < 0) {
  console.error("必須列が見つかりません（サービス名, 冊数, ページ）:", headers);
  process.exit(1);
}

const items = [];
for (let r = 1; r < rows.length; r++) {
  const line = rows[r];
  const title = String(line[hi.title] ?? "").trim();
  const book = String(line[hi.book] ?? "").trim();
  const page = String(line[hi.page] ?? "").trim();
  const dateRaw = hi.date >= 0 ? String(line[hi.date] ?? "").trim() : "";
  if (!title && !book && !page) continue;
  const d = toIsoDate(dateRaw);
  items.push({
    title,
    book,
    page,
    createdAt: d,
    updatedAt: d,
  });
}

const payload = {
  app: APP_ID,
  version: JSON_VERSION,
  exportedAt: new Date().toISOString(),
  planCode: PLAN_CODE,
  itemLimit: ITEM_LIMIT,
  items,
};

fs.writeFileSync(absOut, JSON.stringify(payload, null, 2), "utf8");
console.log("出力:", absOut);
console.log("件数:", items.length);
