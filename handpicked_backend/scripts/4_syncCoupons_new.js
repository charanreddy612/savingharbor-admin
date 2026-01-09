/**
 * Sync coupons from Excel into Supabase - OPTIMIZED VERSION (FINAL)
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
 * 
 * OPTIMIZATIONS:
 * 1. Batch fetch all merchants with pagination (no 1000 row limit)
 * 2. Batch fetch existing coupons at once
 * 3. Batch insert new coupons (1000 at a time)
 * 4. Reduced database round trips from ~40k to ~25
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */

const COUPONS_XLSX = path.join(process.cwd(), "coupons.xlsx");
const BATCH_SIZE = 1000; // Supabase can handle 1000 rows per insert

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
   BATCH HELPERS
========================= */

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/* =========================
   MAIN
========================= */

async function run() {
  const startTime = Date.now();
  console.log("📥 Reading coupons.xlsx...");

  // 1. READ EXCEL FILE
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
    if (title.toLowerCase() === "(no title)") return;

    const key = `${store_name}||${coupon_type}||${title}`;
    if (!uniqueRows.has(key)) {
      uniqueRows.set(key, { store_name, coupon_type, title });
    }
  });

  console.log(`🔎 Found ${uniqueRows.size} unique coupon rows`);

  // 2. BATCH FETCH ALL MERCHANTS WITH PAGINATION (NO 1000 ROW LIMIT)
  console.log("📦 Fetching all merchants...");
  
  let allMerchants = [];
  let from = 0;
  const pageSize = 1000;
  
  while (true) {
    const { data, error: merchantErr } = await supabase
      .from("merchants")
      .select("id, name, web_url")
      .range(from, from + pageSize - 1);

    if (merchantErr) throw merchantErr;
    
    if (!data || data.length === 0) break;
    
    allMerchants = allMerchants.concat(data);
    console.log(`   Fetched ${allMerchants.length} merchants so far...`);
    
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // Create a case-insensitive merchant lookup map
  const merchantMap = new Map();
  allMerchants.forEach(m => {
    merchantMap.set(m.name.toLowerCase(), m);
  });

  console.log(`✅ Loaded ${allMerchants.length} merchants total`);

  // 3. PREPARE COUPON DATA WITH MERCHANT INFO
  const couponsToProcess = [];
  const missingMerchants = new Set();

  for (const { store_name, coupon_type, title } of uniqueRows.values()) {
    const merchant = merchantMap.get(store_name.toLowerCase());
    
    if (!merchant) {
      missingMerchants.add(store_name);
      continue;
    }

    couponsToProcess.push({
      merchant_id: merchant.id,
      aff_url: merchant.web_url,
      coupon_type,
      title,
      store_name, // Keep for reference
    });
  }

  if (missingMerchants.size > 0) {
    console.warn(`⚠️ ${missingMerchants.size} merchants not found:`, [...missingMerchants].slice(0, 10).join(", "));
  }

  console.log(`📝 Processing ${couponsToProcess.length} coupons`);

  // 4. BATCH FETCH EXISTING COUPONS
  console.log("🔍 Checking existing coupons...");
  
  const merchantIds = [...new Set(couponsToProcess.map(c => c.merchant_id))];
  const existingCouponsMap = new Map();
  
  // Fetch existing coupons in batches (merchants might have many coupons)
  for (let i = 0; i < merchantIds.length; i += 100) {
    const batchIds = merchantIds.slice(i, i + 100);
    
    const { data: existingCoupons, error: fetchErr } = await supabase
      .from("coupons")
      .select("id, merchant_id, coupon_type, title, coupon_code")
      .in("merchant_id", batchIds);

    if (fetchErr) throw fetchErr;

    existingCoupons.forEach(c => {
      // Include coupon_code in the key to match original logic
      // For deals, coupon_code is "", for others it's null
      const couponCodePart = c.coupon_code === null ? "NULL" : (c.coupon_code || "EMPTY");
      const key = `${c.merchant_id}||${c.coupon_type}||${c.title}||${couponCodePart}`;
      existingCouponsMap.set(key, c.id);
    });
  }

  console.log(`✅ Found ${existingCouponsMap.size} existing coupons`);

  // 5. DETERMINE WHAT TO INSERT
  const couponsToInsert = [];

  for (const coupon of couponsToProcess) {
    // Match the original duplicate check logic exactly
    const couponCodeForKey = coupon.coupon_type === "deal" ? "EMPTY" : "NULL";
    const key = `${coupon.merchant_id}||${coupon.coupon_type}||${coupon.title}||${couponCodeForKey}`;
    
    if (!existingCouponsMap.has(key)) {
      couponsToInsert.push({
        merchant_id: coupon.merchant_id,
        aff_url: coupon.aff_url,
        coupon_type: coupon.coupon_type,
        title: coupon.title,
        description: randomDescription(coupon.title),
        h_block: "",
        coupon_code: coupon.coupon_type === "deal" ? "" : null,
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
      });
    }
  }

  const reusedCount = couponsToProcess.length - couponsToInsert.length;

  console.log(`\n📊 Summary:`);
  console.log(`   To insert: ${couponsToInsert.length}`);
  console.log(`   Already exist: ${reusedCount}`);

  // 6. BATCH INSERT NEW COUPONS
  if (couponsToInsert.length > 0) {
    console.log(`\n💾 Inserting ${couponsToInsert.length} new coupons in batches...`);
    
    const batches = chunkArray(couponsToInsert, BATCH_SIZE);
    let insertedCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      const { error: insertErr } = await supabase
        .from("coupons")
        .insert(batch);

      if (insertErr) {
        console.error(`❌ Batch ${i + 1}/${batches.length} failed:`, insertErr);
        throw insertErr;
      }

      insertedCount += batch.length;
      console.log(`   ✓ Batch ${i + 1}/${batches.length} complete (${insertedCount}/${couponsToInsert.length})`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n✅ Coupon sync complete!");
  console.log(`   Inserted : ${couponsToInsert.length}`);
  console.log(`   Reused   : ${reusedCount}`);
  console.log(`   Duration : ${duration}s`);
  console.log(`   Speed    : ${Math.round(couponsToProcess.length / duration)} records/sec`);
}

run().catch((err) => {
  console.error("❌ Sync failed:", err.message || err);
  process.exit(1);
});