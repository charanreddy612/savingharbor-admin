/**
 * Sync merchant categories from stores.xlsx into Supabase
 *
 * Reads:
 *  - store_category
 *  - store_subcategory
 *
 * Inserts into:
 *  - merchant_categories (parents first, then children)
 *
 * SAFE TO RE-RUN
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */

const STORES_XLSX = path.join(process.cwd(), "scripts/stores.xlsx");

/* =========================
   HELPERS
========================= */

function normalize(text) {
  return text?.toString().replace(/\s+/g, " ").trim() || "";
}

function slugify(text) {
  return normalize(text)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function buildMeta(name) {
  return {
    description: `Explore top deals, discounts, and offers from leading brands in the ${name} category. Discover savings across popular stores and enjoy the best shopping experience online.`,
    meta_title: `Best ${name} Deals & Coupons | Latest Discounts`,
    meta_description: `Find verified ${name} coupons, promo codes, and exclusive deals from trusted brands. Save more on your favorite products today.`,
    meta_keywords: `${name} deals, ${name} coupons, ${name} discounts, promo codes, online offers`,
  };
}

/* =========================
   CORE: ENSURE CATEGORY (HARD SAFE)
========================= */

async function ensureCategory({ name, parent_id = null }) {
  const slug = slugify(name);

  // HARD SAFE SELECT (NO maybeSingle)
  const { data, error } = await supabase
    .from("merchant_categories")
    .select("id")
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;

  if (data && data.length > 0) {
    return { id: data[0].id, created: false };
  }

  const meta = buildMeta(name);

  const { data: inserted, error: insertErr } = await supabase
    .from("merchant_categories")
    .insert({
      name,
      slug,
      parent_id,
      description: meta.description,
      meta_title: meta.meta_title,
      meta_description: meta.meta_description,
      meta_keywords: meta.meta_keywords,
      is_publish: true,
      show_home: false,
      show_deals_page: false,
      is_header: false,
    })
    .select("id")
    .single();

  if (insertErr) throw insertErr;

  console.log(`✔ inserted: ${name} (parent=${parent_id ?? "NULL"})`);

  return { id: inserted.id, created: true };
}

/* =========================
   MAIN
========================= */

async function run() {
  console.log("📥 Reading stores.xlsx...");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(STORES_XLSX);
  const worksheet = workbook.worksheets[0];

  /* ---- map headers ---- */
  const headerMap = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    headerMap[normalize(cell.value)] = col;
  });

  /* ---- collect parents + children separately ---- */
  const parentSet = new Set();
  const childPairs = new Map(); // key = parent||child

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const category = normalize(row.getCell(headerMap["store_category"])?.value);
    const subcategory = normalize(
      row.getCell(headerMap["store_subcategory"])?.value
    );

    if (!category) return;

    parentSet.add(category);

    if (subcategory) {
      const key = `${category}||${subcategory}`;
      if (!childPairs.has(key)) {
        childPairs.set(key, { category, subcategory });
      }
    }
  });

  console.log(`🔎 Parents found : ${parentSet.size}`);
  console.log(`🔎 Children found: ${childPairs.size}\n`);

  /* ---- INSERT PARENTS FIRST ---- */
  const parentIdMap = new Map();
  let parentsInserted = 0;
  let parentsReused = 0;

  for (const category of parentSet) {
    const res = await ensureCategory({ name: category });
    parentIdMap.set(category, res.id);
    res.created ? parentsInserted++ : parentsReused++;
  }

  /* ---- INSERT CHILDREN ---- */
  let childrenInserted = 0;
  let childrenReused = 0;

  for (const { category, subcategory } of childPairs.values()) {
    const parent_id = parentIdMap.get(category);
    if (!parent_id) continue;

    const res = await ensureCategory({
      name: subcategory,
      parent_id,
    });

    res.created ? childrenInserted++ : childrenReused++;
  }

  /* ---- SUMMARY ---- */
  console.log("\n✅ Category sync complete");
  console.log(`   Parents inserted : ${parentsInserted}`);
  console.log(`   Parents reused   : ${parentsReused}`);
  console.log(`   Children inserted: ${childrenInserted}`);
  console.log(`   Children reused  : ${childrenReused}`);
}

run().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
