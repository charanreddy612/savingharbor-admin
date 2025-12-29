/**
 * Update merchants data: meta_title, side_description_html, description_html, web_url, h1keyword
 *
 * Reads:
 *  - merchants table
 *
 * Updates:
 *  - meta_title
 *  - side_description_html
 *  - description_html (with line breaks)
 *  - web_url
 *  - h1keyword
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */

const STORES_XLSX = path.join(process.cwd(), "scripts/stores.xlsx");

// Templates
const META_TITLE_TEMPLATE =
  "Latest {{merchantName}} Coupon Codes & {{category}} Deals";
const SIDE_DESCRIPTION_HTML = `If you are planning to shop for {{Merchant Category}} online, using the latest {{Merchant Name}} coupons, promo codes, and discount offers can help you save more on every order. Instead of paying the full price, you can apply active {{Merchant Name}} coupon codes during checkout and unlock instant savings on a wide range of {{Merchant Category}} products. Whether you are shopping for personal use, gifts, or seasonal needs, keeping an eye on updated {{Merchant Name}} deals and offers is one of the smartest ways to control your budget without compromising on quality or choice. Before completing your purchase, simply search for new {{Merchant Name}} promo codes and apply whichever gives you the best price. With the right timing and a valid coupon, saving on {{Merchant Category}} becomes simple, fast, and convenient.`;

const DESCRIPTION_HTML = `H2 - Why People Shop at {{Merchant Name}} for {{Merchant Category}}

Shopping for {{Merchant Category}} online gives you flexibility, variety, and convenience — and when you combine that experience with valid {{Merchant Name}} coupons and deals, the value multiplies. Many shoppers prefer {{Merchant Name}} because it allows them to browse different options at their own pace, compare prices, and then apply {{Merchant Name}} coupon codes to reduce the final bill. This simple habit of checking for {{Merchant Name}} offers before paying turns a normal purchase into a smarter one.

Instead of impulse buying, customers today are more intentional and savings-focused. They plan, compare, and use {{Merchant Name}} discount codes to make sure they get the best possible price on {{Merchant Category}}. This is exactly where {{Merchant Name}} becomes useful — not only for variety, but also for savings opportunities through {{Merchant Name}} promo codes and seasonal deals.

H2 - What Shoppers Usually Look For in {{Merchant Category}}

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

H2 - How {{Merchant Name}} Coupons & Deals Help You Save Money

{{Merchant Name}} coupons and promo codes work by giving you instant discounts at checkout. Depending on the offer terms, these may apply to:

specific product categories

cart-wide purchases

selected brands or items

minimum order values

Even when the base price is already discounted, a valid {{Merchant Name}} coupon code may reduce the cost further where allowed. That’s why experienced shoppers always check for:

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

Using {{Merchant Name}} coupons is not only about discounts — it also encourages better budgeting habits. Planning purchases around:

real needs

valid {{Merchant Name}} offers

seasonal price drops

allows you to enjoy {{Merchant Category}} without financial stress. Over time, this mindset builds long-term savings discipline.

H2 – Summary: Why {{Merchant Name}} Coupons Are Worth Checking

To conclude, combining {{Merchant Name}} coupon codes, promo codes, deals, and discount offers with thoughtful timing helps you save consistently on {{Merchant Category}} purchases. Whether you are a regular shopper or buying occasionally, making it a habit to search for {{Merchant Name}} coupons before checkout is one of the simplest ways to reduce your overall spending and get maximum value from every order.`; // truncated for brevity; add the full template

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

function replaceTemplates(template, merchantName, category) {
  return template
    .replace(/{{Merchant Name}}/g, merchantName)
    .replace(/{{merchantName}}/g, merchantName)
    .replace(/{{Merchant Category}}/g, category)
    .replace(/{{category}}/g, category);
}

// Wrap line breaks as <p> for HTML rendering
function formatDescriptionHtml(template, merchantName, category) {
  let text = replaceTemplates(template, merchantName, category);

  // Convert H1/H2 markers to real tags
  text = text.replace(/^H1\s*-\s*(.*)$/gm, "<h1>$1</h1>");
  text = text.replace(/^H2\s*[-–]\s*(.*)$/gm, "<h2>$1</h2>");

  // Wrap remaining paragraphs in <p> tags
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p) // skip empty lines
    .map((p) => (p.startsWith("<h") ? p : `<p>${p}</p>`))
    .join("\n");
}

function buildMetaTitle(merchantName, category) {
  return replaceTemplates(META_TITLE_TEMPLATE, merchantName, category);
}

function buildH1Keyword(merchantName, category) {
  return `${merchantName} Coupons, Promo Codes & Discount Deals on ${category}`;
}

/* =========================
   MAIN
========================= */

async function run() {
  console.log("📥 Reading stores.xlsx...");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(STORES_XLSX);
  const worksheet = workbook.worksheets[0];

  const headerMap = {};
  worksheet.getRow(1).eachCell((cell, col) => {
    headerMap[cell.value] = col;
  });

  const merchants = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const storeName = normalize(row.getCell(headerMap["store_name"])?.value);
    const storeUrl = normalize(row.getCell(headerMap["store_url"])?.value);
    const storeCategory = normalize(
      row.getCell(headerMap["store_category"])?.value
    );

    if (!storeName) return;

    merchants.push({ storeName, storeUrl, storeCategory });
  });

  console.log(`🔎 Found ${merchants.length} merchants to update\n`);

  let updatedCount = 0;

  for (const { storeName, storeUrl, storeCategory } of merchants) {
    const slug = slugify(storeName) + "-coupons";

    const { error } = await supabase
      .from("merchants")
      .update({
        meta_title: buildMetaTitle(storeName, storeCategory),
        side_description_html: replaceTemplates(
          SIDE_DESCRIPTION_HTML,
          storeName,
          storeCategory
        ),
        description_html: formatDescriptionHtml(
          DESCRIPTION_HTML,
          storeName,
          storeCategory
        ),
        web_url: storeUrl,
        h1keyword: buildH1Keyword(storeName, storeCategory),
      })
      .eq("slug", slug);

    if (error) {
      console.error(
        `❌ Failed to update ${storeName}:`,
        error.message || error
      );
    } else {
      updatedCount++;
      console.log(`✅ Updated ${storeName}`);
    }
  }

  console.log(`\n🎯 Update complete. Total merchants updated: ${updatedCount}`);
}

run().catch((err) => {
  console.error("❌ Script failed:", err.message || err);
  process.exit(1);
});
