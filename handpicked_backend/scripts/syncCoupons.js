/**
 * Sync coupons from Excel into Supabase
 *
 * Reads:
 *  - store_name
 *  - coupon_type
 *  - title
 *
 * Inserts into:
 *  - coupons
 *
 * Safe to re-run (idempotent)
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */

const COUPONS_XLSX = path.join(process.cwd(), "scripts/coupons.xlsx");

/* =========================
   DESCRIPTION TEMPLATES
========================= */

const DESCRIPTION_TEMPLATES = [
  "Grab {{title}}, Enhance your shopping experience by saving more. Limited time offer.",
  "Save {{title}}, Shop your favorite items and enjoy unbeatable discounts today!.",
  "Vibe with {{title}}, Shop your favorites and save big for a limited time only. Act now and make the most of these unbeatable savings!.",
  "Check out {{title}}, Find the latest over sitewide orders. Hurry up. Offer Ends Soon.",
  "{{title}}, Savings will be automatically applied.",
];

function randomDescription(title) {
  const template =
    DESCRIPTION_TEMPLATES[
      Math.floor(Math.random() * DESCRIPTION_TEMPLATES.length)
    ];
  return template.replace(/{{title}}/g, title);
}

function randomClickCount() {
  return Math.floor(Math.random() * (400 - 200 + 1)) + 200;
}

/* =========================
   CORE: ENSURE COUPON
========================= */

async function ensureCoupon({ merchant_id, aff_url, coupon_type, title }) {
  // Check if coupon already exists
  const { data: existing, error: selectErr } = await supabase
    .from("coupons")
    .select("id")
    .eq("merchant_id", merchant_id)
    .eq("coupon_type", coupon_type)
    .eq("title", title)
    .eq("coupon_code", coupon_type === "deal" ? "" : null)
    .limit(1)
    .maybeSingle();

  if (selectErr) throw selectErr;

  if (existing?.id) {
    return { id: existing.id, created: false };
  }

  // Insert coupon
  const { data: inserted, error: insertErr } = await supabase
    .from("coupons")
    .insert({
      merchant_id,
      aff_url,
      coupon_type,
      title,
      description: randomDescription(title),
      h_block: "",
      coupon_code: coupon_type === "deal" ? "" : null,
      type_text: null,
      image_url: null,
      proof_image_url: null,
      show_proof: false,
      filter_id: null,
      category_id: null,
      starts_at: null,
      ends_at: null,
      is_editor: false,
      editor_order: 0,
      is_publish: true,
      home: false,
      is_brand_coupon: false,
      coupon_style: "custom",
      special_msg_type: "",
      special_msg: "",
      push_to: "",
      level: "",
      click_count: randomClickCount(),
    })
    .select("id")
    .single();

  if (insertErr) throw insertErr;

  return { id: inserted.id, created: true };
}

/* =========================
   MAIN
========================= */

async function run() {
  console.log("📥 Reading coupons.xlsx...");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(COUPONS_XLSX);
  const worksheet = workbook.worksheets[0];

  const headerMap = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    headerMap[cell.value] = col;
  });

  const uniqueRows = new Map();

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const store_name = row
      .getCell(headerMap["store_name"])
      ?.value?.toString()
      .trim();
    const coupon_type = row
      .getCell(headerMap["coupon_type"])
      ?.value?.toString()
      .trim();
    const title = row.getCell(headerMap["title"])?.value?.toString().trim();

    if (!store_name || !coupon_type || !title) return;
    if (title.toLowerCase() === "(no title)") return; // skip empty/no-title rows

    const key = `${store_name}||${coupon_type}||${title}`;
    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, { store_name, coupon_type, title });
    }
  });

  console.log(`🔎 Found ${uniqueRows.size} unique coupon rows\n`);

  let insertedCount = 0;
  let reusedCount = 0;

  for (const { store_name, coupon_type, title } of uniqueRows.values()) {
    // Get merchant info
    const { data: merchant, error: merchantErr } = await supabase
      .from("merchants")
      .select("id, web_url")
      .ilike("name", store_name)
      .limit(1)
      .maybeSingle();

    if (merchantErr) throw merchantErr;
    if (!merchant) {
      console.warn(`⚠️ Merchant not found: ${store_name}`);
      continue;
    }

    const couponRes = await ensureCoupon({
      merchant_id: merchant.id,
      aff_url: merchant.web_url,
      coupon_type,
      title,
    });

    couponRes.created ? insertedCount++ : reusedCount++;
  }

  console.log("\n✅ Coupon sync complete");
  console.log(`   Inserted : ${insertedCount}`);
  console.log(`   Reused   : ${reusedCount}`);
}

run().catch((err) => {
  console.error("❌ Sync failed:", err.message || err);
  process.exit(1);
});
