/**
 * Update ONLY web_url for existing merchants (performance optimized)
 *
 * Reads:
 *  - stores.xlsx → store_name, store_url
 *
 * Updates:
 *  - merchants.web_url
 *
 * Strategy:
 *  - Batch fetch existing merchants
 *  - Slug-based matching
 *  - Skip unchanged URLs
 *  - Batch updates
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */
const STORES_XLSX = path.join(process.cwd(), "stores.xlsx");
const FETCH_PAGE_SIZE = 1000;
const UPDATE_BATCH_SIZE = 200;

/* =========================
   HELPERS
========================= */
function normalize(text) {
  return text?.toString().trim() || "";
}

function slugify(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/* =========================
   MAIN
========================= */
async function run() {
  console.log("📥 Reading stores.xlsx...");

  // 1. READ EXCEL
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(STORES_XLSX);
  const worksheet = workbook.worksheets[0];

  const headerMap = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    headerMap[cell.value] = col;
  });

  const excelMap = new Map(); // slug -> web_url

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const storeName = normalize(row.getCell(headerMap["store_name"])?.value);
    const storeUrl = normalize(row.getCell(headerMap["store_url"])?.value);

    if (!storeName || !storeUrl) return;

    const slug = slugify(storeName) + "-coupons";
    excelMap.set(slug, storeUrl);
  });

  console.log(`📊 Excel merchants loaded: ${excelMap.size}`);

  // 2. FETCH EXISTING MERCHANTS (BATCHED)
  console.log("\n📦 Fetching merchants from DB...");

  let existing = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("merchants")
      .select("id, slug, web_url")
      .ilike("name", "Y%") // only names starting with P
      .range(from, from + FETCH_PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    existing = existing.concat(data);
    if (data.length < FETCH_PAGE_SIZE) break;

    from += FETCH_PAGE_SIZE;
  }

  console.log(`✅ Merchants fetched: ${existing.length}`);

  // 3. DIFF & PREPARE UPDATES
  const updates = [];

  for (const merchant of existing) {
    const newUrl = excelMap.get(merchant.slug);
    if (!newUrl) continue;

    if (merchant.web_url !== newUrl) {
      updates.push({
        id: merchant.id,
        web_url: newUrl,
      });
    }
  }

  console.log(`🔄 web_url updates needed: ${updates.length}`);

  // 4. BATCH UPDATE
  const chunks = chunkArray(updates, UPDATE_BATCH_SIZE);
  let updated = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    await Promise.all(
      chunk.map((m) =>
        supabase.from("merchants").update({ web_url: m.web_url }).eq("id", m.id)
      )
    );

    updated += chunk.length;
    console.log(`   ✓ Updated ${updated}/${updates.length}`);
  }

  console.log("\n✅ web_url update complete");
}

run().catch((err) => {
  console.error("❌ Script failed:", err.message || err);
  process.exit(1);
});
