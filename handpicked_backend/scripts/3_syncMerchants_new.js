/**
 * Sync merchants from stores.xlsx into Supabase
 *
 * Reads:
 *  - store_name
 *  - store_category
 *  - store_subcategory
 *
 * Inserts into:
 *  - merchants table
 *
 * Safe to re-run (idempotent)
 *
 * OPTIMIZATIONS:
 * 1. Batch fetch all existing merchants at once
 * 2. Batch insert new merchants (1000 at a time)
 * 3. Batch update existing merchants with merged subcategories
 * 4. Reduced database round trips from ~thousands to ~10-20
 */

import path from "path";
import ExcelJS from "exceljs";
import axios from "axios";
import sharp from "sharp";
import { supabase } from "../dbhelper/dbclient.js";
import { uploadImageBuffer } from "../services/storageService.js";

/* =========================
   CONFIG
========================= */
const STORES_XLSX = path.join(process.cwd(), "stores.xlsx");
const BATCH_SIZE = 1000;

const LOGO_BUCKET = "merchant-images";
const LOGO_FOLDER = "merchants";

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

function replacePlaceholders(template, merchantName, category) {
  return template
    .replace(/{{Merchant Name}}/g, merchantName)
    .replace(/{{merchantName}}/g, merchantName)
    .replace(/{{Merchant Category}}/g, category)
    .replace(/{{category}}/g, category)
    .replace(
      /{{Month & Year}}/g,
      new Date().toLocaleString("default", { month: "long", year: "numeric" })
    );
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function getFileNameFromUrl(url) {
  try {
    const u = new URL(url);
    return path.basename(u.pathname);
  } catch {
    return `logo-${Date.now()}`;
  }
}

async function downloadImage(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30000,
    validateStatus: (s) => s >= 200 && s < 400,
  });

  return Buffer.from(res.data);
}

async function convertToWebp(buffer) {
  return sharp(buffer).webp({ quality: 85 }).toBuffer();
}

const sideDescriptionHTML = `
H1

{{Merchant Name}} Coupons, Promo Codes & Discount Deals on {{Merchant Category}}

If you are planning to shop for {{Merchant Category}} online, using the latest {{Merchant Name}} coupons, promo codes, and discount offers can help you save more on every order. Instead of paying the full price, you can apply active {{Merchant Name}} coupon codes during checkout and unlock instant savings on a wide range of {{Merchant Category}} products. Whether you are shopping for personal use, gifts, or seasonal needs, keeping an eye on updated {{Merchant Name}} deals and offers is one of the smartest ways to control your budget without compromising on quality or choice. Before completing your purchase, simply search for new {{Merchant Name}} promo codes and apply whichever gives you the best price. With the right timing and a valid {{Merchant Name}} coupon, saving on {{Merchant Category}} becomes simple, fast, and convenient.
`;

const descriptionHTML = `
H2 – Why People Shop at {{Merchant Name}} for {{Merchant Category}}

Shopping for {{Merchant Category}} online gives you flexibility, variety, and convenience – and when you combine that experience with valid {{Merchant Name}} coupons and deals, the value multiplies. Many shoppers prefer {{Merchant Name}} because it allows them to browse different options at their own pace, compare prices, and then apply {{Merchant Name}} coupon codes to reduce the final bill. This simple habit of checking for {{Merchant Name}} offers before paying turns a normal purchase into a smarter one.

Instead of impulse buying, customers today are more intentional and savings-focused. They plan, compare, and use {{Merchant Name}} discount codes to make sure they get the best possible price on {{Merchant Category}}. This is exactly where {{Merchant Name}} becomes useful – not only for variety, but also for savings opportunities through {{Merchant Name}} promo codes and seasonal deals.

H2 – What Shoppers Usually Look For in {{Merchant Category}}

People search for {{Merchant Category}} for many reasons such as:

daily use items

lifestyle upgrades

gifts for friends and family

seasonal purchases

hobby or interest-based shopping

Typical choices inside {{Merchant Category}} include both basic essentials and premium options. When paired with valid {{Merchant Name}} coupon codes, even higher-value purchases can feel more affordable.

Customers often wait for:

clearance sales

festival sales

end-of-season offers

site-wide {{Merchant Name}} {{Merchant Category}} sale events

During these periods, combining discounts with {{Merchant Name}} promo codes can unlock even bigger savings.

H2 – How {{Merchant Name}} Coupons & Deals Help You Save Money

{{Merchant Name}} coupons and promo codes work by giving you instant discounts at checkout. Depending on the offer terms, these may apply to:

specific product categories

cart-wide purchases

selected brands or items

minimum order values

Even when the base price is already discounted, a valid {{Merchant Name}} coupon code may reduce the cost further where allowed. That's why experienced shoppers always check for:

{{Merchant Name}} coupons

{{Merchant Name}} offers

{{Merchant Name}} deals

{{Merchant Name}} discount codes

before placing any order related to {{Merchant Category}}.

Over time, this single habit can create massive cumulative savings.

H2 – Best Strategy to Use {{Merchant Name}} Coupon Codes Effectively

Here is a practical, beginner-friendly approach:

Decide what you want from {{Merchant Category}}

Add your preferred items to the cart

Search for {{Merchant Name}} coupon codes and promo codes

Try the best two or three codes

Compare which one gives maximum discount

Proceed to payment only after the final price feels right

If none of the {{Merchant Name}} offers apply today, you can:

wait for an upcoming {{Merchant Name}} {{Merchant Category}} sale, or

bookmark the page and revisit later

This converts random buying into strategic shopping.

H2 – When Do {{Merchant Name}} {{Merchant Category}} Deals Get Better?

Savings often improve during:

festive seasons

year-end clearances

payday sales

seasonal launch or clearance periods

During such events, you may notice more active {{Merchant Name}} coupons, promo codes, and {{Merchant Category}} deals popping up. Checking regularly increases your chances of catching a better offer and applying the right {{Merchant Name}} coupon code at the right time.

H2 – Who Can Benefit the Most from {{Merchant Name}} Coupons?

The following shopper groups benefit strongly:

budget-focused shoppers who compare before buying

students and families aiming to control expenses

frequent online shoppers who buy {{Merchant Category}} regularly

gift buyers who shop seasonally

new shoppers trying {{Merchant Name}} for the first time

For all of them, combining shopping plans with {{Merchant Name}} discounts and offers turns a normal purchase into a smarter financial decision.

H2 – Common Mistakes While Using {{Merchant Name}} Coupon Codes

To avoid losing savings, keep these simple tips in mind:

check expiry dates

ensure {{Merchant Category}} item is eligible

meet any minimum order amount

avoid spacing or typos in code entry

try multiple {{Merchant Name}} promo codes when permitted

Most coupon failures happen because of small technicalities. Reviewing these conditions helps {{Merchant Name}} coupon codes apply smoothly.

H2 – Responsible Shopping & Smart Budgeting with {{Merchant Name}}

Using {{Merchant Name}} coupons is not only about discounts – it also encourages better budgeting habits. Planning purchases around:

real needs

valid {{Merchant Name}} offers

seasonal price drops

allows you to enjoy {{Merchant Category}} without financial stress. Over time, this mindset builds long-term savings discipline.

H2 – Summary: Why {{Merchant Name}} Coupons Are Worth Checking

To conclude, combining {{Merchant Name}} coupon codes, promo codes, deals, and discount offers with thoughtful timing helps you save consistently on {{Merchant Category}} purchases. Whether you are a regular shopper or buying occasionally, making it a habit to search for {{Merchant Name}} coupons before checkout is one of the simplest ways to reduce your overall spending and get maximum value from every order.

H2 – Frequently Asked Questions About {{Merchant Name}}
`;

// 15 FAQs
const faqs = [
  {
    question: "Where do I apply a {{Merchant Name}} coupon code?",
    answer:
      "You can usually apply a {{Merchant Name}} coupon code on the checkout or payment page. After adding {{Merchant Category}} items to your cart, look for a box labeled 'Coupon Code,' 'Promo Code,' or 'Apply Discount.' Enter the code carefully, apply it, and the revised total will be shown instantly if the offer is valid.",
  },
  {
    question:
      "How often are new {{Merchant Name}} coupons and promo codes released?",
    answer:
      "New {{Merchant Name}} coupons and promo codes may be released during sales, seasons, festivals, product launches, or promotional campaigns. The availability changes frequently, which is why many shoppers check regularly for updated {{Merchant Name}} deals and offers before placing an order.",
  },
  {
    question:
      "Can I use more than one {{Merchant Name}} coupon in the same order?",
    answer:
      "Most orders allow the use of only one {{Merchant Name}} coupon code at a time. However, this single code may already include strong savings or bundled offers. Terms vary by promotion, so it's always best to check the specific offer details before completing payment.",
  },
  {
    question:
      "What should I do if a {{Merchant Name}} coupon code doesn't work?",
    answer:
      "If the {{Merchant Name}} coupon doesn't apply, check if the code has expired, review eligibility, ensure minimum cart value, remove extra spaces or typos, or try another active {{Merchant Name}} promo code.",
  },
  {
    question:
      "Do {{Merchant Name}} offers apply to all {{Merchant Category}} items?",
    answer:
      "Some {{Merchant Name}} offers apply to site-wide purchases, while others are limited to selected {{Merchant Category}} products, brands, or minimum purchase conditions. Always review the specific terms listed with each deal or coupon.",
  },
  {
    question:
      "Is there any {{Merchant Name}} {{Merchant Category}} sale during festivals or seasons?",
    answer:
      "Yes, seasonal and festival periods often bring bigger {{Merchant Name}} {{Merchant Category}} sales, along with fresh coupons, promo codes, and discount offers. Checking around major sale seasons increases your chances of catching better deals.",
  },
  {
    question:
      "Are {{Merchant Name}} discounts valid on already discounted products?",
    answer:
      "Sometimes {{Merchant Name}} discounts and promo codes can be applied on already discounted items, but in other cases, they apply only to full-priced products. Always read eligibility details before relying on stacking discounts.",
  },
  {
    question:
      "How do I get the best {{Merchant Name}} {{Merchant Category}} deals?",
    answer:
      "Check ongoing sales, compare multiple {{Merchant Name}} coupon codes, place orders during seasonal or festival offers, subscribe to alerts, and recheck deals before final checkout.",
  },
  {
    question: "Are there first-time shopper offers for {{Merchant Name}}?",
    answer:
      "Sometimes first-time shopper offers or new user discounts are available at {{Merchant Name}}. Availability changes frequently, so checking current offers is always worthwhile.",
  },
  {
    question:
      "Can {{Merchant Name}} coupon codes be used on the mobile app and website both?",
    answer:
      "In many cases, {{Merchant Name}} coupon codes can be used on both the website and mobile app, though some deals may be exclusive to one platform.",
  },
  {
    question: "Why is my {{Merchant Name}} coupon showing invalid?",
    answer:
      "A {{Merchant Name}} coupon may show invalid due to expired validity, ineligible items, minimum cart value not met, or user errors like typos.",
  },
  {
    question:
      "Do {{Merchant Name}} {{Merchant Category}} deals change frequently?",
    answer:
      "Yes, deals can change often. New offers may be added, and expired ones removed based on campaigns, seasons, and inventory. Frequent checking ensures you don't miss better deals.",
  },
  {
    question: "Are {{Merchant Name}} discounts cumulative?",
    answer:
      "Some discounts can stack, but others cannot. Always read the terms of the coupon or promotion to know if multiple discounts apply.",
  },
  {
    question:
      "What's the best way to use {{Merchant Name}} coupons efficiently?",
    answer:
      "Compare codes, apply the best ones, and use them during sales or promotions to maximize savings on {{Merchant Category}}.",
  },
  {
    question: "How can I stay updated with new {{Merchant Name}} coupons?",
    answer:
      "Subscribe to newsletters, check coupon websites, or follow {{Merchant Name}} updates to stay informed about new deals and offers.",
  },
];

/* =========================
   MAIN
========================= */
async function run() {
  const startTime = Date.now();
  console.log("📥 Reading stores.xlsx...");

  // 1. READ EXCEL FILE
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(STORES_XLSX);
  const worksheet = workbook.worksheets[0];

  const headerMap = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    headerMap[cell.value] = col;
  });

  console.log("📋 Excel headers found:", Object.keys(headerMap));

  // Map merchantName -> { category, subcategories[] }
  const merchantsMap = new Map();
  let totalRowsRead = 0;
  let skippedRows = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    totalRowsRead++;

    const storeName = normalize(row.getCell(headerMap["store_name"])?.value);
    const category = normalize(row.getCell(headerMap["store_category"])?.value);
    const subcategory = normalize(
      row.getCell(headerMap["store_subcategory"])?.value
    );
    const logoUrl = normalize(row.getCell(headerMap["logo_url"])?.value);

    if (!storeName || !category) {
      skippedRows++;
      return;
    }

    if (!merchantsMap.has(storeName)) {
      merchantsMap.set(storeName, { category, subcategories: [], logoUrl });
    }

    if (subcategory) {
      const merchantData = merchantsMap.get(storeName);
      if (!merchantData.subcategories.includes(subcategory)) {
        merchantData.subcategories.push(subcategory);
      }
    }
  });

  console.log(`\n📊 Excel Read Summary:`);
  console.log(`   Total rows read: ${totalRowsRead}`);
  console.log(`   Skipped (no data): ${skippedRows}`);
  console.log(`   Unique merchants: ${merchantsMap.size}`);

  // Sample first 3 merchants for debugging
  console.log(`\n🔍 First 3 merchants:`);
  [...merchantsMap.entries()].slice(0, 3).forEach(([name, data], i) => {
    console.log(
      `   ${i + 1}. ${name} | ${data.category} | Subcats: ${
        data.subcategories.length
      }`
    );
  });

  // 2. BATCH FETCH ALL EXISTING MERCHANTS WITH PAGINATION
  console.log("\n📦 Fetching existing merchants from database...");

  let existingMerchants = [];
  let from = 0;
  const pageSize = 1000;
  let pageNum = 1;

  while (true) {
    const { data, error: fetchErr } = await supabase
      .from("merchants")
      .select("id, slug, brand_categories, logo_url")
      .ilike("name", "Z%") // only names starting with P
      .range(from, from + pageSize - 1);

    if (fetchErr) {
      console.error("❌ Error fetching merchants:", fetchErr);
      throw fetchErr;
    }

    if (!data || data.length === 0) {
      console.log(`   Page ${pageNum}: No more data`);
      break;
    }

    existingMerchants = existingMerchants.concat(data);
    console.log(
      `   Page ${pageNum}: Fetched ${data.length} merchants (Total: ${existingMerchants.length})`
    );

    if (data.length < pageSize) {
      console.log(`   ✓ Reached last page`);
      break;
    }

    from += pageSize;
    pageNum++;
  }

  // Create slug -> merchant map for fast lookup
  const existingMap = new Map();
  existingMerchants.forEach((m) => {
    existingMap.set(m.slug, m);
  });

  console.log(
    `✅ Total existing merchants loaded: ${existingMerchants.length}`
  );
  console.log(`   Unique slugs in map: ${existingMap.size}`);

  // 3. PREPARE DATA FOR INSERT/UPDATE
  console.log("\n🔄 Analyzing what needs to be inserted/updated...");
  const merchantsToInsert = [];
  const merchantsToUpdate = [];
  const slugsToInsert = new Set(); // Track slugs to prevent duplicates in insert batch
  let unchangedCount = 0;
  let duplicateSlugsInExcel = 0;

  for (const [
    storeName,
    { category, subcategories },
  ] of merchantsMap.entries()) {
    const slug = slugify(storeName) + "-coupons";
    const existing = existingMap.get(slug); // ← Duplicate check against DB

    // Debug the first few merchants
    if (
      merchantsToInsert.length + merchantsToUpdate.length + unchangedCount <
      3
    ) {
      console.log(
        `   Checking: "${storeName}" → slug: "${slug}" → exists: ${!!existing}`
      );
    }

    const sideDesc = replacePlaceholders(
      sideDescriptionHTML,
      storeName,
      category
    );
    const descHTML = replacePlaceholders(descriptionHTML, storeName, category);
    const faqsReplaced = faqs.map((f) => ({
      question: replacePlaceholders(f.question, storeName, category),
      answer: replacePlaceholders(f.answer, storeName, category),
    }));

    const metaTitle = replacePlaceholders(
      "Latest {{merchantName}} Coupon Codes & {{category}} Deals Month & Year",
      storeName,
      category
    );
    const metaDescription = replacePlaceholders(
      "Use verified {{merchantName}} coupons, promo codes and discount offers to save on {{category}}. Get the latest {{merchantName}} deals before checkout and cut your online shopping bill.",
      storeName,
      category
    );
    const metaKeywords = replacePlaceholders(
      "{{merchantName}} coupons, {{merchantName}} promo codes, {{merchantName}} deals, {{category}} discounts, online offers",
      storeName,
      category
    );

    if (existing) {
      // DUPLICATE FOUND IN DB - Check if subcategories need updating
      const mergedSubcats = Array.from(
        new Set([...(existing.brand_categories || []), ...subcategories])
      );

      // Only update if subcategories actually changed
      if (
        JSON.stringify(mergedSubcats.sort()) !==
        JSON.stringify((existing.brand_categories || []).sort())
      ) {
        merchantsToUpdate.push({
          id: existing.id,
          slug: slug,
          brand_categories: mergedSubcats,
        });
      } else {
        // Merchant exists and subcategories unchanged - skip
        unchangedCount++;
      }
    } else if (slugsToInsert.has(slug)) {
      // DUPLICATE SLUG IN EXCEL - Skip to avoid batch insert failure
      console.warn(
        `   ⚠️ Duplicate slug in Excel: "${slug}" from "${storeName}" (already queued for insert)`
      );
      duplicateSlugsInExcel++;
    } else {
      // NEW MERCHANT - Not in database yet
      slugsToInsert.add(slug); // Track this slug
      merchantsToInsert.push({
        name: storeName,
        slug,
        category_names: [category],
        brand_categories: subcategories,
        meta_title: metaTitle,
        meta_description: metaDescription,
        meta_keywords: metaKeywords,
        side_description_html: sideDesc,
        description_html: descHTML,
        faqs: faqsReplaced,
        is_publish: true,
        active: true,
        home: false,
        sidebar: false,
        ads_block_all: false,
        ads_block_banners: false,
        is_header: false,
        deals_home: false,
        tag_home: false,
        amazon_store: false,
        show_at_search_bar: false,
        extension_active: false,
        extension_mandatory: false,
        is_header_2: false,
        coupon_icon_visibility: "visible",
        store_status_visibility: "visible",
      });
    }
  }

  console.log(`\n📊 Processing Summary:`);
  console.log(`   New merchants to insert: ${merchantsToInsert.length}`);
  console.log(`   Existing merchants to update: ${merchantsToUpdate.length}`);
  console.log(`   Already in DB (unchanged): ${unchangedCount}`);
  console.log(
    `   Duplicate slugs in Excel (skipped): ${duplicateSlugsInExcel}`
  );
  console.log(`   Total processed: ${merchantsMap.size}`);
  console.log(
    `   ✅ Duplicate check complete - no duplicates will be inserted`
  );

  // Sample data to insert
  if (merchantsToInsert.length > 0) {
    console.log(`\n🔍 First 3 merchants to insert:`);
    merchantsToInsert.slice(0, 3).forEach((m, i) => {
      console.log(
        `   ${i + 1}. ${m.name} | Slug: ${m.slug} | Subcats: ${
          m.brand_categories.length
        }`
      );
    });
  }

  // Sample data to update
  if (merchantsToUpdate.length > 0) {
    console.log(`\n🔍 First 3 merchants to update:`);
    merchantsToUpdate.slice(0, 3).forEach((m, i) => {
      console.log(
        `   ${i + 1}. ID: ${m.id} | Slug: ${m.slug} | New subcats: ${
          m.brand_categories.length
        }`
      );
    });
  }

  // 4. BATCH INSERT NEW MERCHANTS
  let insertedCount = 0;
  if (merchantsToInsert.length > 0) {
    console.log(
      `\n💾 Inserting ${merchantsToInsert.length} new merchants in batches...`
    );

    // Debug: Check which merchant has the problematic slug
    const problematicSlug = "flobeds-coupons";
    const problematicMerchant = merchantsToInsert.find(
      (m) => m.slug === problematicSlug
    );
    if (problematicMerchant) {
      console.log(`   🔍 Found merchant with slug "${problematicSlug}":`);
      console.log(`      Name: "${problematicMerchant.name}"`);
      console.log(`      Slug: "${problematicMerchant.slug}"`);
    }

    const batches = chunkArray(merchantsToInsert, BATCH_SIZE);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      console.log(
        `\n   Attempting batch ${i + 1}/${batches.length} with ${
          batch.length
        } merchants...`
      );

      // Debug: Show first 3 slugs in this batch
      console.log(`   First 3 slugs in batch:`);
      batch.slice(0, 3).forEach((m, idx) => {
        console.log(`      ${idx + 1}. ${m.slug} (from "${m.name}")`);
      });

      const { error: insertErr } = await supabase
        .from("merchants")
        .insert(batch);

      if (insertErr) {
        console.error(`❌ Batch ${i + 1}/${batches.length} failed:`, insertErr);

        // Try to find which specific merchant caused the error
        if (insertErr.details && insertErr.details.includes("Key (slug)=")) {
          const match = insertErr.details.match(/Key \(slug\)=\(([^)]+)\)/);
          if (match) {
            const failedSlug = match[1];
            const failedMerchant = batch.find((m) => m.slug === failedSlug);
            if (failedMerchant) {
              console.error(`   🔍 Failed merchant details:`);
              console.error(`      Name: "${failedMerchant.name}"`);
              console.error(`      Slug: "${failedMerchant.slug}"`);
            }
          }
        }

        throw insertErr;
      }

      insertedCount += batch.length;
      console.log(
        `   ✓ Batch ${i + 1}/${batches.length} complete (${insertedCount}/${
          merchantsToInsert.length
        })`
      );
    }
  }

  // 5. BATCH UPDATE EXISTING MERCHANTS
  let updatedCount = 0;
  if (merchantsToUpdate.length > 0) {
    console.log(
      `\n🔄 Updating ${merchantsToUpdate.length} merchants with new subcategories...`
    );

    // Supabase doesn't support batch updates directly, so we do them in parallel
    // but in smaller chunks to avoid overwhelming the connection
    const updateChunks = chunkArray(merchantsToUpdate, 50);

    for (let i = 0; i < updateChunks.length; i++) {
      const chunk = updateChunks[i];

      await Promise.all(
        chunk.map((merchant) =>
          supabase
            .from("merchants")
            .update({ brand_categories: merchant.brand_categories })
            .eq("id", merchant.id)
        )
      );

      updatedCount += chunk.length;
      console.log(`   ✓ Updated ${updatedCount}/${merchantsToUpdate.length}`);
    }
  }

  console.log("\n🖼️ Processing merchant logos...");

  const logoTasks = [];

  for (const [storeName, data] of merchantsMap.entries()) {
    if (!data.logoUrl) continue;

    const slug = slugify(storeName) + "-coupons";
    const existing = existingMap.get(slug);

    // 🔒 SKIP if logo already exists in DB
    if (existing?.logo_url) continue;

    logoTasks.push(async () => {
      try {
        const buffer = await downloadImage(data.logoUrl);
        const webp = await convertToWebp(buffer);

        const filename = getFileNameFromUrl(data.logoUrl).replace(
          /\.(png|jpg|jpeg|webp)$/i,
          ".webp"
        );

        const { url, error } = await uploadImageBuffer(
          LOGO_BUCKET,
          LOGO_FOLDER,
          webp,
          filename,
          "image/webp"
        );

        if (error || !url) throw error;

        await supabase
          .from("merchants")
          .update({ logo_url: url })
          .eq("slug", slug);

        console.log(`   ✅ Logo updated: ${storeName}`);
      } catch (err) {
        console.error(`   ❌ Logo failed: ${storeName} → ${err.message}`);
      }
    });
  }

  // limit parallelism
  const LOGO_BATCH = 10;
  for (let i = 0; i < logoTasks.length; i += LOGO_BATCH) {
    await Promise.all(logoTasks.slice(i, i + LOGO_BATCH).map((fn) => fn()));
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("\n✅ Merchants sync complete!");
  console.log(`   Inserted : ${insertedCount}`);
  console.log(`   Updated  : ${updatedCount}`);
  //  console.log(`   Unchanged: ${reusedCount}`);
  console.log(`   Duration : ${duration}s`);
  console.log(
    `   Speed    : ${Math.round(merchantsMap.size / duration)} records/sec`
  );
}

run().catch((err) => {
  console.error("❌ Sync failed:", err.message || err);
  process.exit(1);
});
