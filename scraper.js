"use strict";
/**
 * Steuerberater Scraper — Gelbe Seiten edition.
 * Mirrors RootCanal scraper.js logic (one location per run, file-based state).
 *
 * - Reads locations_state.json for progress tracking
 * - Processes ONE location per run, then stops
 * - Saves leads to leads_CITY_DE.json per city
 * - Deduplicates in-memory via Set of website URLs / kanzlei+city keys
 * - For each listing entry: also fetches GS profile page to get external website URL
 * - Marks location as scraped in locations_state.json after processing
 *
 * Usage:
 *   node scraper.js           # live
 *   node scraper.js --dry-run # preview only
 *
 * Run generateLocations.js first to create locations_state.json.
 */

require("dotenv").config();
const axios   = require("axios");
const cheerio = require("cheerio");
const fs      = require("fs");
const path    = require("path");

const GS_BASE     = "https://www.gelbeseiten.de";
const DATA_DIR    = process.env.DATA_DIR || __dirname;
const STATE_FILE  = path.join(DATA_DIR, "locations_state.json");
const LAST_SCRAPE = path.join(DATA_DIR, "last_scrape.json");
const DELAY_MS    = 1200;
const DRY_RUN     = process.argv.includes("--dry-run");

const sleep = ms => new Promise(r => setTimeout(r, ms));

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "de-DE,de;q=0.9",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  },
});

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error("❌ locations_state.json not found. Run: node generateLocations.js");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function leadsFilePath(city) {
  return path.join(DATA_DIR, `leads_${city.replace(/\s/g, "_")}_DE.json`);
}

function loadLeads(city) {
  const file = leadsFilePath(city);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  return [];
}

function saveLeads(city, leads) {
  fs.writeFileSync(leadsFilePath(city), JSON.stringify(leads, null, 2));
}

function recordScrapeTime() {
  fs.writeFileSync(LAST_SCRAPE, JSON.stringify({ lastScrapeAt: new Date().toISOString() }));
}

// ─── PARSING ──────────────────────────────────────────────────────────────────

/**
 * Extract the canonical city name and zip from the address string.
 * Format: "Straße Nr, PLZ Stadt (Ortsteil) 0.3 km"
 */
function parseAddress(addrText) {
  if (!addrText) return { zip: null, addrCity: null };
  // Match 5-digit PLZ
  const m = addrText.match(/\b(\d{5})\b/);
  const zip = m ? m[1] : null;
  // City after PLZ
  const cityM = addrText.match(/\d{5}\s+([^,(]+)/);
  const addrCity = cityM ? cityM[1].trim() : null;
  return { zip, addrCity };
}

/**
 * Parse listing page HTML → array of raw lead objects (without external website yet).
 * Each has: kanzlei_name, city, zip, phone, gs_profile_url
 */
function parseListingPage(html, cityName) {
  const $ = cheerio.load(html);
  const results = [];

  // Gelbe Seiten uses <article class="mod mod-Treffer"> or div.mod-Treffer__container
  $("article[data-wipe-name], article.mod-Treffer, div.mod-Treffer__container").each((_, el) => {
    const $el = $(el);

    // Company name: h2.mod-Treffer__name or p.mod-Treffer__name or heading
    const kanzlei_name =
      $el.find(".mod-Treffer__name, h2.mod-Treffer__name, p.mod-Treffer__name").first().text().trim() ||
      $el.find("h2, h3").first().text().trim() ||
      null;

    if (!kanzlei_name) return;

    // Phone
    const phone =
      $el.find(".mod-Treffer__phone, [class*='phone'], [class*='telefon']").first().text().trim() ||
      $el.find("a[href^='tel:']").first().text().trim() ||
      null;

    // Address
    const addrText = $el.find(".mod-Treffer__address, [class*='address'], [itemprop='address']").first().text().trim();
    const { zip, addrCity } = parseAddress(addrText);

    // Internal GS profile link (e.g. /gsbiz/UUID)
    const profileHref = $el.find("a[href*='/gsbiz/']").first().attr("href") ||
                        $el.find("h2 a, h3 a, .mod-Treffer__name a").first().attr("href");
    const gs_profile_url = profileHref
      ? (profileHref.startsWith("http") ? profileHref : `${GS_BASE}${profileHref}`)
      : null;

    results.push({
      kanzlei_name,
      city:           addrCity || cityName,
      zip:            zip || null,
      phone:          phone || null,
      gs_profile_url: gs_profile_url || null,
    });
  });

  return results;
}

/**
 * Fetch a GS profile page and extract the external website URL.
 * Looks for <a>Webseite</a> or website link in action bar.
 */
async function fetchWebsite(profileUrl) {
  if (!profileUrl) return null;
  try {
    const res = await http.get(profileUrl);
    const $   = cheerio.load(res.data);

    // Look for "Webseite" link text (exact match to avoid adjacent text contamination)
    const websiteAnchor = $("a[href]").filter((_, a) => {
      const text = $(a).text().trim().toLowerCase().replace(/\s+/g, " ");
      return text === "webseite" || text === "website" || text === "zur webseite" ||
             text === "zur website" || text === "homepage";
    }).first();

    if (websiteAnchor.length) {
      const href = websiteAnchor.attr("href") || "";
      if (href.startsWith("http") && !href.includes("gelbeseiten.de")) {
        try {
          const u = new URL(href);
          return u.origin + u.pathname.replace(/\/$/, "");
        } catch { /* invalid URL */ }
      }
    }

    // Fallback: any external href not on gelbeseiten.de
    let found = null;
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href");
      if (
        href &&
        href.startsWith("http") &&
        !href.includes("gelbeseiten.de") &&
        !href.includes("google.com") &&
        !href.includes("facebook.com") &&
        !href.includes("instagram.com") &&
        !href.includes("twitter.com") &&
        !href.includes("youtube.com") &&
        !href.includes("linkedin.com") &&
        !href.includes("xing.com")
      ) {
        found = href.replace(/\/$/, "");
        return false; // break
      }
    });
    return found;
  } catch {
    return null;
  }
}

// ─── SCRAPE ONE LOCATION ──────────────────────────────────────────────────────

async function scrapeLocation(slug, cityName, existingKeys) {
  const url = `${GS_BASE}/branchen/steuerberater/${encodeURIComponent(slug)}`;
  let html;

  try {
    const res = await http.get(url);
    html = res.data;
  } catch (err) {
    console.error(`  [${slug}] ✗ ${err.message}`);
    return [];
  }

  const raw = parseListingPage(html, cityName);
  console.log(`  Found ${raw.length} listings on page`);

  const results = [];

  for (const entry of raw) {
    const dedupeKey = entry.gs_profile_url || `${entry.kanzlei_name}__${entry.city}`;
    if (existingKeys.has(dedupeKey)) continue;
    existingKeys.add(dedupeKey);

    // Fetch profile page to get external website URL
    let website = null;
    if (entry.gs_profile_url) {
      await sleep(DELAY_MS);
      website = await fetchWebsite(entry.gs_profile_url);
    }

    results.push({
      kanzlei_name:   entry.kanzlei_name,
      name:           null,             // GS doesn't always show person name on listing
      city:           entry.city,
      zip:            entry.zip,
      phone:          entry.phone,
      website:        website,
      email:          null,
    });
  }

  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const state = loadState();

  const pending = state.filter(l => !l.scraped);
  console.log(`\n=== Steuerberater Scraper (Gelbe Seiten) ===`);
  console.log(`   Locations remaining : ${pending.length} / ${state.length}`);
  console.log(`   Mode                : ${DRY_RUN ? "DRY RUN" : "LIVE"}\n`);

  if (pending.length === 0) {
    console.log("✓ All locations scraped. Nothing to do.");
    return;
  }

  // Pick next unscraped location
  const locEntry = pending[0];
  const { city, slug } = locEntry;

  console.log(`📍 Location: "${slug}" → city bucket: ${city}`);

  if (DRY_RUN) {
    console.log(`[dry-run] Would scrape: ${GS_BASE}/branchen/steuerberater/${encodeURIComponent(slug)}`);
    return;
  }

  // Load existing leads for dedup
  const leads       = loadLeads(city);
  const existingKeys = new Set(
    leads.map(l => l.gs_profile_url || l.website || `${l.kanzlei_name}__${l.city}`)
  );

  const newLeads = await scrapeLocation(slug, city, existingKeys);

  console.log(`  → ${newLeads.length} new leads`);

  for (const l of newLeads) leads.push(l);
  saveLeads(city, leads);

  // Mark location as scraped
  locEntry.scraped = true;
  saveState(state);
  recordScrapeTime();

  console.log(`  Total in ${city} file: ${leads.length} leads`);
  console.log(`  Next run will process: "${pending[1]?.slug ?? "none (all done)"}"\n`);
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
