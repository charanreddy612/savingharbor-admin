/**
 * URL Discoverer
 * Extracts and classifies internal links from homepage nav/footer
 */

import * as cheerio from 'cheerio';

const TIMEOUT_MS = 10000;

const CLASSIFIERS = {
  about:     ['about', 'our-story', 'who-we-are', 'brand', 'mission', 'history', 'founder', 'press', 'story', 'company', 'team'],
  faq:       ['faq', 'faqs', 'frequently-asked', 'help', 'support', 'questions', 'help-center', 'knowledge', 'customer-service'],
  shipping:  ['shipping', 'delivery', 'dispatch', 'shipping-info', 'shipping-policy', 'order-info'],
  returns:   ['return', 'refund', 'exchange', 'return-policy', 'refund-policy', 'money-back'],
  sale:      ['sale', 'offers', 'deals', 'promotions', 'clearance', 'outlet', 'discount'],
  financing: ['financing', 'payment-plan', 'affirm', 'klarna', 'afterpay', 'sezzle', 'pay-later'],
  blog:      ['blog', 'news', 'journal', 'stories', 'articles', 'guides'],
};

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SavingHarborBot/1.0; +https://savingharbor.com)',
        'Accept': 'text/html,application/xhtml+xml,*/*',
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

function classifyUrl(href, linkText) {
  const path     = href.toLowerCase();
  const combined = `${path} ${linkText.toLowerCase()}`;

  // Hard rules by path prefix
  if (path.includes('/collections/') || path.includes('/products/')) return null; // skip product pages
  if (path.includes('/blogs/') || path.includes('/blog/'))           return 'blog';

  // Keyword match
  for (const [category, keywords] of Object.entries(CLASSIFIERS)) {
    if (keywords.some(k => combined.includes(k))) return category;
  }
  return null;
}

export async function discoverUrls(webUrl) {
  const base = webUrl.replace(/\/$/, '');
  const result = {
    classified:    { about: [], faq: [], shipping: [], returns: [], sale: [], financing: [], blog: [] },
    homepageHtml:  null,
  };

  const html = await fetchHtml(base);
  if (!html) return result;
  result.homepageHtml = html;

  const $ = cheerio.load(html);
  const baseHost = new URL(base).hostname;
  const seen = new Set();

  const SELECTORS = [
    'header a', 'nav a', 'footer a',
    '[class*="menu"] a', '[class*="nav"] a', '[class*="footer"] a',
    '[id*="footer"] a', '[id*="nav"] a', '[role="navigation"] a',
  ];

  for (const sel of SELECTORS) {
    $(sel).each((_, el) => {
      const rawHref = $(el).attr('href')?.trim();
      const text    = $(el).text().trim().toLowerCase();
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;

      let absolute;
      try { absolute = new URL(rawHref, base).href; } catch { return; }

      try { if (new URL(absolute).hostname !== baseHost) return; } catch { return; }

      const clean = absolute.split('?')[0].split('#')[0].replace(/\/$/, '');
      if (clean === base || seen.has(clean)) return;
      seen.add(clean);

      const category = classifyUrl(clean, text);
      if (category && result.classified[category]) {
        result.classified[category].push({ url: clean, text, source: sel.split(' ')[0] });
      }
    });
  }

  // Sort — /pages/ URLs first
  for (const cat of Object.keys(result.classified)) {
    result.classified[cat].sort((a, b) => {
      const aScore = a.url.includes('/pages/') ? 0 : a.url.includes('/blogs/') ? 1 : 2;
      const bScore = b.url.includes('/pages/') ? 0 : b.url.includes('/blogs/') ? 1 : 2;
      return aScore - bScore;
    });
    // Limit per category
    result.classified[cat] = result.classified[cat].slice(0, 3);
  }

  return result;
}
