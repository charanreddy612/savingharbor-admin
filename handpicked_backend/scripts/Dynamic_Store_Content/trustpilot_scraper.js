/**
 * Trustpilot Scraper
 * Scrapes public Trustpilot pages for rating, reviews, snippets
 *
 * FIXES:
 * 1. Added Playwright fallback — Trustpilot is JS-rendered, cheerio alone often fails
 * 2. Rating extraction targets specific DOM elements before falling back to text regex
 * 3. Multiple selector strategies for current Trustpilot HTML structure
 * 4. Review snippet selectors updated to match current Trustpilot markup
 */

import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

const TIMEOUT_MS       = 12000;
const PLAYWRIGHT_TIMEOUT = 15000;
const PLAYWRIGHT_WAIT    = 3000;

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchWithPlaywright(url) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PLAYWRIGHT_TIMEOUT });
    await page.waitForTimeout(PLAYWRIGHT_WAIT);
    return await page.content();
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const result = {
    found: false,
    rating: null,
    reviewCount: null,
    snippets: [],
    commonPraise: [],
    commonComplaints: [],
    claimed: false,
  };

  // ── Rating extraction ────────────────────────────────────────────────────────
  // Strategy 1: data attributes (most reliable)
  const ratingAttrEl = $('[data-rating-typography], [class*="ratingValue"], [class*="trustScore"]').first();
  if (ratingAttrEl.length) {
    const val = parseFloat(ratingAttrEl.text().trim());
    if (!isNaN(val) && val >= 1 && val <= 5) result.rating = val;
  }

  // Strategy 2: look for the specific score element Trustpilot uses
  if (!result.rating) {
    $('[class*="score"], [class*="Score"]').each((_, el) => {
      const val = parseFloat($(el).text().trim());
      if (!isNaN(val) && val >= 1 && val <= 5) {
        result.rating = val;
        return false; // break
      }
    });
  }

  // Strategy 3: JSON-LD schema on page
  if (!result.rating) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        const schema = Array.isArray(json) ? json[0] : json;
        const ratingValue = schema?.aggregateRating?.ratingValue
          || schema?.['@graph']?.find?.(n => n.aggregateRating)?.aggregateRating?.ratingValue;
        if (ratingValue) {
          const val = parseFloat(ratingValue);
          if (!isNaN(val) && val >= 1 && val <= 5) result.rating = val;
        }
        const count = schema?.aggregateRating?.reviewCount
          || schema?.aggregateRating?.ratingCount;
        if (count && !result.reviewCount) result.reviewCount = parseInt(count);
      } catch {}
    });
  }

  // Strategy 4: text regex fallback (least reliable — only TrustScore pattern, not "X out of 5")
  if (!result.rating) {
    const bodyText = $('body').text();
    const tsMatch = bodyText.match(/TrustScore\s+([\d.]+)/i);
    if (tsMatch) {
      const val = parseFloat(tsMatch[1]);
      if (!isNaN(val) && val >= 1 && val <= 5) result.rating = val;
    }
  }

  // ── Review count ─────────────────────────────────────────────────────────────
  if (!result.reviewCount) {
    const bodyText = $('body').text();
    // Be specific — "X reviews" but not "write a review"
    const countMatch = bodyText.match(/([\d,]+)\s+reviews?(?!\s*write|\s*read|\s*filter)/i);
    if (countMatch) result.reviewCount = parseInt(countMatch[1].replace(/,/g, ''));
  }

  // ── Review snippets ──────────────────────────────────────────────────────────
  // Multiple selector strategies for current Trustpilot markup
  const snippetSelectors = [
    '[data-service-review-text-typography]',
    '[class*="reviewText"]',
    '[class*="review-content__text"]',
    '[class*="review_reviewBody"]',
    '[class*="typography_body"]',
    'article p',
    'section p',
  ];

  const snippets = new Set();
  for (const sel of snippetSelectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().trim();
      // Must be a plausible review: 40-500 chars, not navigation/UI text
      if (
        t.length >= 40 &&
        t.length <= 500 &&
        !/(cookie|privacy|sign in|log in|write a review|filter|sort by|date of experience)/i.test(t)
      ) {
        snippets.add(t);
      }
    });
    if (snippets.size >= 6) break;
  }
  result.snippets = [...snippets].slice(0, 6);

  // ── Claimed status ───────────────────────────────────────────────────────────
  result.claimed = /claimed profile|verified company/i.test($('body').text());

  // ── Sentiment from snippets ──────────────────────────────────────────────────
  if (result.snippets.length) {
    const allText = result.snippets.join(' ').toLowerCase();
    result.commonPraise     = ['great', 'excellent', 'amazing', 'quality', 'fast', 'recommend', 'best', 'happy', 'fantastic'].filter(k => allText.includes(k));
    result.commonComplaints = ['late', 'slow', 'broken', 'damaged', 'wrong', 'missing', 'poor', 'disappointed', 'never'].filter(k => allText.includes(k));
  }

  result.found = result.rating !== null || result.reviewCount !== null || result.snippets.length > 0;
  return result;
}

export async function scrapeTrustpilot(webUrl) {
  const empty = { found: false, rating: null, reviewCount: null, snippets: [], commonPraise: [], commonComplaints: [], claimed: false };

  let domain;
  try { domain = new URL(webUrl).hostname.replace(/^www\./, ''); } catch { return empty; }

  const tpUrl = `https://www.trustpilot.com/review/${domain}`;

  // Try cheerio first
  const html = await fetchHtml(tpUrl);
  if (html) {
    const result = parseHtml(html);
    // If we got rating AND review count, cheerio worked — return immediately
    if (result.rating && result.reviewCount) return result;
  }

  // Fallback: Playwright (Trustpilot is JS-rendered — this is often necessary)
  const pwHtml = await fetchWithPlaywright(tpUrl);
  if (pwHtml) {
    return parseHtml(pwHtml);
  }

  return empty;
}
