/**
 * Update merchants field-level data from stores.xlsx
 *
 * Updates only:
 *  - side_description_html
 *  - description_html
 *  - faqs
 *
 * Uses existing merchant name and category for placeholder replacement
 */

import path from "path";
import ExcelJS from "exceljs";
import { supabase } from "../dbhelper/dbclient.js";

/* =========================
   CONFIG
========================= */
const STORES_XLSX = path.join(process.cwd(), "stores.xlsx");
const BATCH_SIZE = 100;
const BATCH_DELAY_MS = 1000;

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
      new Date().toLocaleString("default", { month: "long", year: "numeric" }),
    );
}

function formatDescriptionHtml(template, name, category) {
  let text = replacePlaceholders(template, name, category);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const result = [];
  let inList = false;
  let listItems = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // List start marker
    if (line === "[LIST_START]") {
      inList = true;
      continue;
    }

    // List end marker
    if (line === "[LIST_END]") {
      if (listItems.length > 0) {
        result.push(
          "<ul>" + listItems.map((li) => `<li>${li}</li>`).join("") + "</ul>",
        );
        listItems = [];
      }
      inList = false;
      continue;
    }

    // H1 marker - next line is the heading
    if (line === "H1" && i + 1 < lines.length) {
      result.push(`<h1>${lines[i + 1]}</h1>`);
      i++; // skip next line
      continue;
    }

    // H2 heading
    if (line.match(/^H2\s*[-–]\s*(.+)$/)) {
      const heading = line.replace(/^H2\s*[-–]\s*/, "");
      result.push(`<h2>${heading}</h2>`);
      continue;
    }

    // Collect list items
    if (inList) {
      listItems.push(line);
    } else {
      // Regular paragraph
      result.push(`<p>${line}</p>`);
    }
  }

  return result.join("\n");
}

/* =========================
   TEMPLATES
========================= */
const META_TITLE_TEMPLATE =
  "{{merchantName}} Coupons & Promo Codes";
  
const sideDescriptionHTML = `
H1 
{{Merchant Name}} Coupons, Promo Codes & Discount Deals on {{Merchant Category}}

If you are planning to shop for {{Merchant Category}} online, using the latest {{Merchant Name}} coupons, promo codes, and discount offers can help you save more on every order. Instead of paying the full price, you can apply active {{Merchant Name}} coupon codes during checkout and unlock instant savings on a wide range of {{Merchant Category}} products. Whether you are shopping for personal use, gifts, or seasonal needs, keeping an eye on updated {{Merchant Name}} deals and offers is one of the smartest ways to control your budget without compromising on quality or choice. Before completing your purchase, simply search for new {{Merchant Name}} promo codes and apply whichever gives you the best price. With the right timing and a valid {{Merchant Name}} coupon, saving on {{Merchant Category}} becomes simple, fast, and convenient.
`;

const descriptionHTML = `
H2 – Why People Shop at {{Merchant Name}} for {{Merchant Category}}

Shopping for {{Merchant Category}} online gives you flexibility, variety, and convenience — and when you combine that experience with valid {{Merchant Name}} coupons and deals, the value multiplies. Many shoppers prefer {{Merchant Name}} because it allows them to browse different options at their own pace, compare prices, and then apply {{Merchant Name}} coupon codes to reduce the final bill. This simple habit of checking for {{Merchant Name}} offers before paying turns a normal purchase into a smarter one.

Instead of impulse buying, customers today are more intentional and savings-focused. They plan, compare, and use {{Merchant Name}} discount codes to make sure they get the best possible price on {{Merchant Category}}. This is exactly where {{Merchant Name}} becomes useful — not only for variety, but also for savings opportunities through {{Merchant Name}} promo codes and seasonal deals.

H2 – What Shoppers Usually Look For in {{Merchant Category}}

People search for {{Merchant Category}} for many reasons such as:

[LIST_START]
daily use items

lifestyle upgrades

gifts for friends and family

seasonal purchases

hobby or interest-based shopping
[LIST_END]

Typical choices inside {{Merchant Category}} include both basic essentials and premium options. When paired with valid {{Merchant Name}} coupon codes, even higher-value purchases can feel more affordable.

Customers often wait for:

[LIST_START]
clearance sales

festival sales

end-of-season offers

site-wide {{Merchant Name}} {{Merchant Category}} sale events
[LIST_END]

During these periods, combining discounts with {{Merchant Name}} promo codes can unlock even bigger savings.

H2 – How {{Merchant Name}} Coupons & Deals Help You Save Money

{{Merchant Name}} coupons and promo codes work by giving you instant discounts at checkout. Depending on the offer terms, these may apply to:

[LIST_START]
specific product categories

cart-wide purchases

selected brands or items

minimum order values
[LIST_END]

Even when the base price is already discounted, a valid {{Merchant Name}} coupon code may reduce the cost further where allowed. That's why experienced shoppers always check for:

[LIST_START]
{{Merchant Name}} coupons

{{Merchant Name}} offers

{{Merchant Name}} deals

{{Merchant Name}} discount codes
[LIST_END]

before placing any order related to {{Merchant Category}}.

Over time, this single habit can create massive cumulative savings.

H2 – Best Strategy to Use {{Merchant Name}} Coupon Codes Effectively

Here is a practical, beginner-friendly approach:

[LIST_START]
Decide what you want from {{Merchant Category}}

Add your preferred items to the cart

Search for {{Merchant Name}} coupon codes and promo codes

Try the best two or three codes

Compare which one gives maximum discount

Proceed to payment only after the final price feels right
[LIST_END]

If none of the {{Merchant Name}} offers apply today, you can wait for an upcoming {{Merchant Name}} {{Merchant Category}} sale, or bookmark the page and revisit later.

This converts random buying into strategic shopping.

H2 – When Do {{Merchant Name}} {{Merchant Category}} Deals Get Better?

Savings often improve during:

[LIST_START]
festive seasons

year-end clearances

payday sales

seasonal launch or clearance periods
[LIST_END]

During such events, you may notice more active {{Merchant Name}} coupons, promo codes, and {{Merchant Category}} deals popping up. Checking regularly increases your chances of catching a better offer and applying the right {{Merchant Name}} coupon code at the right time.

H2 – Who Can Benefit the Most from {{Merchant Name}} Coupons?

The following shopper groups benefit strongly:

[LIST_START]
budget-focused shoppers who compare before buying

students and families aiming to control expenses

frequent online shoppers who buy {{Merchant Category}} regularly

gift buyers who shop seasonally

new shoppers trying {{Merchant Name}} for the first time
[LIST_END]

For all of them, combining shopping plans with {{Merchant Name}} discounts and offers turns a normal purchase into a smarter financial decision.

H2 – Common Mistakes While Using {{Merchant Name}} Coupon Codes

To avoid losing savings, keep these simple tips in mind:

[LIST_START]
check expiry dates

ensure {{Merchant Category}} item is eligible

meet any minimum order amount

avoid spacing or typos in code entry

try multiple {{Merchant Name}} promo codes when permitted
[LIST_END]

Most coupon failures happen because of small technicalities. Reviewing these conditions helps {{Merchant Name}} coupon codes apply smoothly.

H2 – Responsible Shopping & Smart Budgeting with {{Merchant Name}}

Using {{Merchant Name}} coupons is not only about discounts — it also encourages better budgeting habits. Planning purchases around:

real needs

valid {{Merchant Name}} offers

seasonal price drops

allows you to enjoy {{Merchant Category}} without financial stress. Over time, this mindset builds long-term savings discipline.

H2 – Summary: Why {{Merchant Name}} Coupons Are Worth Checking

To conclude, combining {{Merchant Name}} coupon codes, promo codes, deals, and discount offers with thoughtful timing helps you save consistently on {{Merchant Category}} purchases. Whether you are a regular shopper or buying occasionally, making it a habit to search for {{Merchant Name}} coupons before checkout is one of the simplest ways to reduce your overall spending and get maximum value from every order.

H2 – Frequently Asked Questions About {{Merchant Name}}
`;

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
   BATCH UPDATE
========================= */
async function batchUpdateMerchants(updates) {
  const promises = updates.map((update) =>
    supabase
      .from("merchants")
      .update({
        meta_title: update.metaTitle,
        side_description_html: update.sideDesc,
        description_html: update.descHTML,
        faqs: update.faqsReplaced,
      })
      .eq("id", update.id)
      .then(({ error }) => {
        if (error) throw error;
      }),
  );

  await Promise.all(promises);
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

  // Collect unique store names
  const storeNames = new Set();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const storeName = normalize(row.getCell(headerMap["store_name"])?.value);
    if (storeName) storeNames.add(storeName);
  });

  console.log(`🔎 Found ${storeNames.size} unique stores in Excel\n`);

  // Generate slugs for batch fetch
  const slugs = Array.from(storeNames).map(
    (name) => slugify(name) + "-coupons",
  );

  console.log("🔍 Fetching merchants from DB...");

  // Batch fetch (Supabase .in() has limits, typically ~1000 items)
  const FETCH_BATCH_SIZE = 500;
  const allMerchants = [];

  for (let i = 0; i < slugs.length; i += FETCH_BATCH_SIZE) {
    const batchSlugs = slugs.slice(i, i + FETCH_BATCH_SIZE);

    const { data, error } = await supabase
      .from("merchants")
      .select("id, name, slug, category_names")
      .in("slug", batchSlugs);

    if (error) {
      console.error("Fetch error:", error);
      throw error;
    }

    allMerchants.push(...data);
    console.log(`   Fetched ${allMerchants.length}/${slugs.length} merchants`);
  }

  const merchants = allMerchants;
  console.log(`✅ Found ${merchants.length} merchants in DB\n`);

  // Prepare updates
  const updates = [];
  for (const merchant of merchants) {
    const merchantName = merchant.name;
    const category = merchant.category_names?.[0] || "Products";

    const metaTitle = replacePlaceholders(
      META_TITLE_TEMPLATE,
      merchantName,
      category,
    );

    const sideDesc = formatDescriptionHtml(
      sideDescriptionHTML,
      merchantName,
      category,
    );
    const descHTML = formatDescriptionHtml(
      descriptionHTML,
      merchantName,
      category,
    );
    const faqsReplaced = faqs.map((f) => ({
      question: replacePlaceholders(f.question, merchantName, category),
      answer: replacePlaceholders(f.answer, merchantName, category),
    }));

    updates.push({
      id: merchant.id,
      metaTitle,
      sideDesc,
      descHTML,
      faqsReplaced,
    });
  }

  console.log(`✅ Prepared ${updates.length} updates\n`);

  // Batch update
  console.log(
    `🔄 Updating ${updates.length} merchants in batches of ${BATCH_SIZE}...\n`,
  );

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await batchUpdateMerchants(batch);
    console.log(
      `   Processed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length}`,
    );

    // Add delay between batches to avoid rate limits
    if (i + BATCH_SIZE < updates.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log("\n✅ Field updates complete");
  console.log(`   Updated: ${updates.length} merchants`);
}

run().catch((err) => {
  console.error("❌ Update failed:", err.message || err);
  console.error("Full error:", JSON.stringify(err, null, 2));
  process.exit(1);
});
