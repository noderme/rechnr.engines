"use strict";
/**
 * Step 2 — Email finder.
 * For rows where email IS NULL but website IS NOT NULL,
 * scrape /impressum and /kontakt pages for email addresses.
 * German law mandates Impressum with email → ~80% hit rate.
 *
 * Usage:
 *   node findEmails.js            # process all missing emails
 *   node findEmails.js --limit 50 # process max 50 records
 *   node findEmails.js --dry-run  # preview only
 */

require("dotenv").config();
const axios   = require("axios");
const cheerio = require("cheerio");
const pool    = require("./db");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const cityArg = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : null;
const DELAY_MS = 1000;

const PAGES_TO_CHECK = ["/impressum", "/kontakt", "/kontakt.html", "/impressum.html", "/datenschutz"];

// Domains to ignore when extracting emails
const SPAM_DOMAINS = [
  "sentry.io", "wix.com", "squarespace.com", "wordpress.com", "example.com",
  "domain.de", "muster.de", "email.de", "test.de", "ihre-domain.de",
];

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const http = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "de-DE,de;q=0.9",
  },
  maxRedirects: 5,
});

function isValidEmail(email) {
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@")[1].toLowerCase();
  if (SPAM_DOMAINS.some(d => domain.includes(d))) return false;
  if (domain.endsWith(".png") || domain.endsWith(".jpg")) return false;
  return true;
}

function normaliseUrl(website) {
  let url = website.trim();
  if (!url.startsWith("http")) url = "https://" + url;
  return url.replace(/\/$/, "");
}

async function findEmailForWebsite(website) {
  const base = normaliseUrl(website);

  for (const path of PAGES_TO_CHECK) {
    const url = base + path;
    try {
      const res = await http.get(url);
      const $   = cheerio.load(res.data);

      // 1. mailto: links — highest confidence
      const mailtoEmails = [];
      $('a[href^="mailto:"]').each((_, el) => {
        const raw = $(el).attr("href").replace("mailto:", "").split("?")[0].trim();
        if (isValidEmail(raw)) mailtoEmails.push(raw);
      });
      if (mailtoEmails.length > 0) return mailtoEmails[0];

      // 2. Regex scan on full text
      const text   = $("body").text();
      const found  = (text.match(EMAIL_RE) || []).filter(isValidEmail);
      if (found.length > 0) return found[0];

    } catch (err) {
      // 404, connection refused, timeout — try next page
    }

    await sleep(DELAY_MS);
  }

  return null;
}

async function main() {
  console.log("=== Email Finder ===");
  if (DRY_RUN) console.log("DRY RUN — no DB writes");

  const conn = await pool.getConnection();

  const conditions = ["email IS NULL", "website IS NOT NULL"];
  const params     = [];
  if (cityArg) { conditions.push("city = ?"); params.push(cityArg); }
  let query = `SELECT id, kanzlei_name, city, website FROM steuerberater_prospects WHERE ${conditions.join(" AND ")}`;
  if (limitArg) query += ` LIMIT ${limitArg}`;

  const [rows] = await conn.execute(query, params);
  console.log(`Found ${rows.length} records to process\n`);

  let found = 0;

  for (const row of rows) {
    process.stdout.write(`[${row.city}] ${row.kanzlei_name} (${row.website}) → `);
    const email = await findEmailForWebsite(row.website);

    if (email) {
      found++;
      console.log(`✓ ${email}`);
      if (!DRY_RUN) {
        await conn.execute(
          `UPDATE steuerberater_prospects SET email = ? WHERE id = ?`,
          [email, row.id]
        );
      }
    } else {
      console.log("✗ not found");
    }

    await sleep(DELAY_MS);
  }

  conn.release();
  await pool.end();

  console.log(`\n=== Done — ${found}/${rows.length} emails found ===`);
}

main().catch(err => { console.error(err); process.exit(1); });
