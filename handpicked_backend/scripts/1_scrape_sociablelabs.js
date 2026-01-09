// scrape_sociablelabs.js - PROPERLY FIXED VERSION
import fs from "fs";
import path from "path";
import { chromium } from "playwright";
import * as cheerio from "cheerio";
import ExcelJS from "exceljs";

const START_URL = process.argv[2] || "https://sociablelabs.com/stores/E";
const OUTPUT_DIR = process.cwd();
const CONCURRENT_PAGES = 3;

function cleanStoreName(raw) {
  if (!raw) return "";
  return raw.replace(/\s*Coupons?\s*$/i, "").trim();
}

async function scrape() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Navigating to stores page...");

  try {
    await page.goto(START_URL, {
      waitUntil: "networkidle",
      timeout: 60000,
    });

    // Wait for dynamic content
    await page.waitForTimeout(3000);

    // Try to find store cards with multiple selectors
    const possibleSelectors = [
      "div.col-md-6.col-xs-12",
      'a[href*="sociablelabs.com"][href*="coupons"]',
      'div[class*="store"]',
      "div.row > div.col-md-6",
    ];

    let storeCards = [];
    let workingSelector = null;

    for (const selector of possibleSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        const count = await page.locator(selector).count();
        if (count > 0) {
          console.log(`✓ Found ${count} elements with selector: ${selector}`);
          workingSelector = selector;
          break;
        }
      } catch (e) {
        console.log(`✗ Selector ${selector} not found`);
      }
    }

    if (!workingSelector) {
      await page.screenshot({ path: "debug-stores-page.png", fullPage: true });
      const html = await page.content();
      fs.writeFileSync("debug-stores-page.html", html);
      throw new Error("Could not find store cards. Check debug files.");
    }

    const listingHTML = await page.content();
    const $ = cheerio.load(listingHTML);

    // Parse store cards
    if (workingSelector === "div.col-md-6.col-xs-12") {
      storeCards = $("div.col-md-6.col-xs-12").toArray();
    } else {
      storeCards = $(workingSelector).toArray();
    }

    console.log(`Found ${storeCards.length} store card(s)\n`);

    const stores = [];

    for (const card of storeCards) {
      const $$ = cheerio.load($.html(card));

      const internalAnchor = $$("div.bold.gr3 > a.gr3").first();
      const logo_url = $$("div.tac img[src*='/images/store-logo/']").attr("src")?.trim() || "";
      const internalHref = internalAnchor.attr("href")?.trim() || "";

      const nameRaw =
        $$("div.bold.gr3 a.gr3 b").first().text().trim() ||
        $$("div.bold.gr3 a.gr3").first().text().trim();
      const store_name = cleanStoreName(nameRaw);

      const externalHref = $$("div.outlink > a").attr("href")?.trim() || "";

      if (store_name && internalHref) {
        stores.push({
          store_name,
          external_url: externalHref,
          internal_url: internalHref,
          logo_url,
        });
      }
    }

    console.log(`Parsed ${stores.length} stores successfully\n`);

    // Excel workbooks
    const storesWB = new ExcelJS.Workbook();
    const storesWS = storesWB.addWorksheet("stores");
    storesWS.columns = [
      { header: "store_name", key: "store_name", width: 40 },
      { header: "store_url", key: "store_url", width: 60 },
      { header: "store_category", key: "store_category", width: 30 },
      { header: "store_subcategory", key: "store_subcategory", width: 30 },
      { header: "logo_url", key: "logo_url", width: 80 },
    ];

    const couponsWB = new ExcelJS.Workbook();
    const couponsWS = couponsWB.addWorksheet("coupons");
    couponsWS.columns = [
      { header: "store_name", key: "store_name", width: 40 },
      { header: "coupon_type", key: "coupon_type", width: 12 },
      { header: "title", key: "title", width: 80 },
      { header: "description", key: "description", width: 120 },
      { header: "code", key: "code", width: 30 },
    ];

    // Store results with categories (one entry per store)
    const storeResults = {};

    // Worker queue
    let idx = 0;
    async function worker() {
      while (true) {
        let i = idx++;
        if (i >= stores.length) break;

        const store = stores[i];
        const internal = store.internal_url;

        console.log(
          `[${i + 1}/${stores.length}] Processing: ${store.store_name}`
        );

        if (!internal) {
          console.warn(`  → No internal URL, skipping\n`);
          storeResults[store.store_name] = {
            store_name: store.store_name,
            store_url: store.external_url,
            store_category: "",
            store_subcategory: "",
            logo_url: store.logo_url || "",
          };
          continue;
        }

        const page2 = await context.newPage();
        try {
          await page2.goto(internal, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page2.waitForTimeout(1500);

          // Save first store detail page for debugging
          if (i === 0) {
            const debugHTML = await page2.content();
            fs.writeFileSync("debug-store-detail.html", debugHTML);
            console.log(`  → Saved debug-store-detail.html`);
          }

          const detailHTML = await page2.content();
          const $$ = cheerio.load(detailHTML);

          // Extract breadcrumbs - try multiple patterns
          let cat = "";
          let subcat = "";

          //   const crumbs = $$("ol.breadcrumb li a")
          //     .toArray()
          //     .map((el) => $$(el).text().trim())
          //     .filter(Boolean);

          //   console.log(`  → Breadcrumbs found: [${crumbs.join(" > ")}]`);

          //   if (crumbs.length >= 2) {
          //     cat = crumbs[crumbs.length - 2] || "";
          //     subcat = crumbs[crumbs.length - 1] || "";
          //   } else if (crumbs.length === 1) {
          //     cat = crumbs[0];
          //   }

          //   console.log(`  → Category: "${cat}" / Subcategory: "${subcat}"`);

          // New breadcrumb extraction for SociableLabs
          const bc = $$('nav[aria-label="Breadcrumb"]');

          let links = bc
            .find("a")
            .toArray()
            .map((el) => $$(el).text().trim());
          let lastSpan = bc.find("span").last().text().trim();

          let crumbs = [...links, lastSpan].filter(Boolean);

          console.log("  → Breadcrumbs found:", crumbs.join(" > "));

          if (crumbs.length >= 3) {
            // [Home, Category, Subcategory, StoreName]
            cat = crumbs[1] || "";
            subcat = crumbs[2] || "";
          } else if (crumbs.length === 2) {
            // [Home, Category]
            cat = crumbs[1] || "";
          }

          console.log(`  → Category: "${cat}" / Subcategory: "${subcat}"`);

          // Store this result (only once per store)
          storeResults[store.store_name] = {
            store_name: store.store_name,
            store_url: store.external_url,
            store_category: cat,
            store_subcategory: subcat,
            logo_url: store.logo_url || "",
          };

          // Find coupons - use ONLY the first matching selector
          let handleCouponElements = [];
          const couponSelectors = [
            "div.coupon-list-item",
            ".coupon",
            ".deal",
            ".cpn",
            "div[class*='coupon']",
            "div[class*='deal']",
          ];

          for (const selector of couponSelectors) {
            const elements = await page2.$$(selector);
            if (elements.length > 0) {
              handleCouponElements = elements;
              console.log(
                `  → Found ${elements.length} coupons using: ${selector}`
              );
              break; // CRITICAL: stop at first match
            }
          }

          if (handleCouponElements.length === 0) {
            console.log(`  → No coupons found`);
          }

          // Track seen coupons to prevent duplicates
          const seenCoupons = new Set();

          for (const elHandle of handleCouponElements) {
            const title =
              (await elHandle
                .$eval("h3, h4, .title, [class*='title']", (node) =>
                  node?.textContent?.trim()
                )
                .catch(() => "")) || "";

            const desc =
              (await elHandle
                .$eval(".desc, .description, p", (node) =>
                  node?.textContent?.trim()
                )
                .catch(() => "")) || "";

            // Determine type
            let type = "";
            const tagText =
              (await elHandle
                .$eval(".deal-tag, .tag, [class*='tag']", (n) =>
                  n?.textContent?.trim()
                )
                .catch(() => "")) || "";

            if (tagText.toLowerCase().includes("deal")) {
              type = "deal";
            } else if (
              tagText.toLowerCase().includes("code") ||
              tagText.toLowerCase().includes("coupon")
            ) {
              type = "coupon";
            } else {
              const hasShowBtn = await elHandle
                .$(
                  "button.show-code, .show-code-btn, button[class*='code'], button[data-action='show-code']"
                )
                .catch(() => null);
              type = hasShowBtn ? "coupon" : "deal";
            }

            // Get coupon code if applicable
            let code = "";
            if (type === "coupon") {
              const showBtn = await elHandle.$(
                "button.show-code, .show-code-btn, button[class*='code']"
              );

              if (showBtn) {
                try {
                  await showBtn.click({ timeout: 3000 }).catch(() => {});
                  await page2.waitForTimeout(500);

                  code =
                    (await elHandle
                      .$eval(
                        ".reveal-code, .code, .coupon-code, [class*='code']",
                        (n) => n?.textContent?.trim()
                      )
                      .catch(() => "")) || "";

                  if (!code) {
                    code =
                      (await page2
                        .$eval(".reveal-code, .code, .coupon-code", (n) =>
                          n?.textContent?.trim()
                        )
                        .catch(() => "")) || "";
                  }

                  code = code.replace(/\s+/g, " ").trim();
                } catch (e) {
                  // Click failed, try to get code directly
                  code =
                    (await elHandle
                      .$eval(
                        ".code, .coupon-code, [data-code]",
                        (n) =>
                          n?.textContent?.trim() || n?.getAttribute("data-code")
                      )
                      .catch(() => "")) || "";
                }
              }
            }

            // Create unique ID to check for duplicates
            const couponKey = `${title}|${desc}|${code}`.toLowerCase();

            if (seenCoupons.has(couponKey)) {
              continue; // Skip duplicate
            }
            seenCoupons.add(couponKey);

            // Add to Excel
            couponsWS.addRow({
              store_name: store.store_name,
              coupon_type: type,
              title: title || desc || "(no title)",
              description: desc || "",
              code: code || "",
            });
          }

          console.log(`  → Added ${seenCoupons.size} unique coupons\n`);

          await page2.close();
        } catch (err) {
          console.error(`  !! Error: ${err?.message}\n`);
          try {
            await page2.close();
          } catch {}

          // Still save store info even if error
          storeResults[store.store_name] = {
            store_name: store.store_name,
            store_url: store.external_url,
            store_category: "",
            store_subcategory: "",
            logo_url: store.logo_url || "",
          };
        }
      }
    }

    // Start workers
    const workers = [];
    for (let w = 0; w < Math.min(CONCURRENT_PAGES, stores.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    // Write store results (one row per store)
    for (const storeData of Object.values(storeResults)) {
      storesWS.addRow(storeData);
    }

    // Save files
    const storesPath = path.join(OUTPUT_DIR, "stores.xlsx");
    const couponsPath = path.join(OUTPUT_DIR, "coupons.xlsx");

    await storesWB.xlsx.writeFile(storesPath);
    await couponsWB.xlsx.writeFile(couponsPath);

    console.log(`\n✅ Done! Files written:`);
    console.log(`   - ${storesPath}`);
    console.log(`   - ${couponsPath}`);
    console.log(`\nStores: ${Object.keys(storeResults).length}`);
    console.log(`Coupons: ${couponsWS.rowCount - 1}`);
  } catch (error) {
    console.error("\n❌ Fatal error:", error.message);
    await page.screenshot({ path: "error-screenshot.png", fullPage: true });
    throw error;
  } finally {
    await browser.close();
  }
}

scrape().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
