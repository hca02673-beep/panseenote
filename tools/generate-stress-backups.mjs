/**
 * 登録上限テスト用バックアップ JSON を生成する。
 * 出力: tools/test-data/panseenote-stress-9999.json
 *       tools/test-data/panseenote-stress-29999.json
 *
 * 取り込み時の件数上限は「現在のライセンスの itemLimit」が使われる（JSON 内 itemLimit は参考用）。
 * スタンダード 10000 件プランなら 9999 件は全件取り込み可能。
 * プレミアム 30000 件プランなら 29999 件は全件取り込み可能。
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "test-data");

const APP_ID = "PenseeNote";
const EXPORT_JSON_VERSION = "1.0";

function randSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

function buildItems(count) {
  const base = Date.now();
  const items = [];
  for (let i = 0; i < count; i++) {
    const n = i + 1;
    items.push({
      title: `負荷テスト${n}-${randSuffix()}`,
      book: String(1 + Math.floor(Math.random() * 99)),
      page: String(1 + Math.floor(Math.random() * 999)),
      memo: `m${randSuffix()}${randSuffix()}`,
      createdAt: new Date(base - i * 1000).toISOString(),
      updatedAt: new Date(base - i * 500).toISOString(),
    });
  }
  return items;
}

function writeBackup(filename, itemCount, itemLimit, planCode) {
  const payload = {
    app: APP_ID,
    version: EXPORT_JSON_VERSION,
    exportedAt: new Date().toISOString(),
    planCode,
    itemLimit,
    items: buildItems(itemCount),
  };
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(payload), "utf8");
  const stat = fs.statSync(outPath);
  console.log(outPath, "items:", itemCount, "bytes:", stat.size);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
writeBackup("panseenote-stress-9999.json", 9999, 10000, "standard");
writeBackup("panseenote-stress-29999.json", 29999, 30000, "premium");
