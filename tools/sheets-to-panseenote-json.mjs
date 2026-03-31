/**
 * Google スプレッドシートからダウンロードした CSV を、パンセノート JSON インポート形式へ変換する。
 *
 * 使い方:
 *   node sheets-to-panseenote-json.mjs <入力.csv> [出力.json]
 *
 * 1行目はヘッダ行とみなし、列名から「見出し・冊数・ページ」を推定します。
 * 推定できない場合は「左から3列 = 見出し, 冊数, ページ」として読みます。
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

function normHeader(h) {
  return String(h || "")
    .trim()
    .normalize("NFKC")
    .toLowerCase();
}

function scoreTitle(h) {
  const n = normHeader(h);
  if (n === "見出し" || n === "title" || n === "タイトル") return 100;
  if (n.includes("見出し") || n.includes("title") || n.includes("タイトル")) return 80;
  if (n.includes("heading") || n === "memo" || n.includes("メモ")) return 40;
  return 0;
}

function scoreBook(h) {
  const n = normHeader(h);
  if (n === "冊数" || n === "冊" || n === "book") return 100;
  if (n.includes("冊")) return 80;
  if (n.includes("book") || n.includes("volume")) return 40;
  return 0;
}

function scorePage(h) {
  const n = normHeader(h);
  if (n === "ページ" || n === "page" || n === "頁") return 100;
  if (n.includes("ページ") || n.includes("page")) return 80;
  return 0;
}

function pickColumn(headers, scorer) {
  let best = -1;
  let idx = -1;
  headers.forEach((h, i) => {
    const s = scorer(h);
    if (s > best) {
      best = s;
      idx = i;
    }
  });
  return best > 0 ? idx : -1;
}

function resolveColumns(headers) {
  const ti = pickColumn(headers, scoreTitle);
  const bi = pickColumn(headers, scoreBook);
  const pi = pickColumn(headers, scorePage);
  if (ti >= 0 && bi >= 0 && pi >= 0 && new Set([ti, bi, pi]).size === 3) {
    return { title: ti, book: bi, page: pi, mode: "header" };
  }
  if (headers.length >= 3) {
    return { title: 0, book: 1, page: 2, mode: "positional" };
  }
  throw new Error("列が不足しています（最低3列必要です）。");
}

function todayDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error(
      "使い方: node sheets-to-panseenote-json.mjs <入力.csv> [出力.json]"
    );
    process.exit(1);
  }
  const inputPath = path.resolve(argv[0]);
  const outPath =
    argv[1] != null
      ? path.resolve(argv[1])
      : inputPath.replace(/\.csv$/i, "") + "-panseenote.json";

  if (!fs.existsSync(inputPath)) {
    console.error("ファイルが見つかりません:", inputPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    /* BOM */
  }
  const text = raw.replace(/^\uFEFF/, "");
  const rows = parseCSV(text);
  if (rows.length < 2) {
    console.error("データ行がありません（ヘッダ＋1行以上が必要です）。");
    process.exit(1);
  }

  const headers = rows[0].map((c) => String(c).trim());
  const cols = resolveColumns(headers);
  const dateStr = todayDateStr();
  const items = [];

  for (let r = 1; r < rows.length; r++) {
    const line = rows[r];
    const title = String(line[cols.title] ?? "").trim();
    const book = String(line[cols.book] ?? "").trim();
    const page = String(line[cols.page] ?? "").trim();
    if (!title && !book && !page) continue;
    items.push({
      title,
      book,
      page,
      createdAt: dateStr,
      updatedAt: dateStr,
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

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log("書き出し:", outPath);
  console.log(
    "行数:",
    items.length,
    "/ 列解決:",
    cols.mode,
    "(見出し列=" + cols.title + ", 冊=" + cols.book + ", ページ=" + cols.page + ")"
  );
}

main();
