"use strict";
/**
 * Reads leads_CITY_DE.json files and inserts new rows into MySQL
 * in the exact order they appear in the JSON (scrape order).
 *
 * INSERT IGNORE prevents duplicates — existing rows are never touched.
 * AUTO_INCREMENT id preserves insertion order, so send.js ORDER BY id ASC
 * guarantees day 1 = rows 1-10, day 2 = rows 11-20, etc.
 *
 * Usage:
 *   node upsert.js                  # all cities
 *   node upsert.js --city Berlin    # one city
 *   node upsert.js --dry-run        # preview only
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const pool = require("./db");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const cityArg = args.includes("--city") ? args[args.indexOf("--city") + 1] : null;

const CITIES = ["Berlin", "München", "Hamburg", "Frankfurt", "Düsseldorf"];
const targets = cityArg ? [cityArg] : CITIES;

const DATA_DIR = process.env.DATA_DIR || __dirname;
function leadsFilePath(city) {
  return path.join(DATA_DIR, `leads_${city.replace(/\s/g, "_")}_DE.json`);
}

async function upsertCity(city, conn) {
  const file = leadsFilePath(city);
  if (!fs.existsSync(file)) {
    console.log(`[${city}] No leads file yet — skipping`);
    return 0;
  }

  const leads = JSON.parse(fs.readFileSync(file, "utf8"));
  if (leads.length === 0) {
    console.log(`[${city}] Empty leads file — skipping`);
    return 0;
  }

  console.log(`[${city}] ${leads.length} leads in file — upserting...`);

  let inserted = 0;

  for (const lead of leads) {
    const { kanzlei_name, name, city: c, website, phone, email } = lead;

    if (DRY_RUN) {
      console.log(`  [dry-run] ${kanzlei_name} | ${website || "no website"} | ${email || "no email"}`);
      continue;
    }

    // INSERT IGNORE — skips row if website already exists (UNIQUE key on website)
    // Falls back to kanzlei_name+city unique check for rows without website
    const [result] = await conn.execute(
      `INSERT IGNORE INTO steuerberater_prospects
         (kanzlei_name, name, city, website, phone, email)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [kanzlei_name || null, name || null, c || city, website || null, phone || null, email || null]
    );

    if (result.affectedRows > 0) inserted++;
  }

  console.log(`[${city}] ${inserted} new rows inserted (${leads.length - inserted} already existed)`);
  return inserted;
}

async function main() {
  console.log("=== Upsert JSON → MySQL ===");
  if (DRY_RUN) console.log("DRY RUN — no DB writes");

  const conn = await pool.getConnection();
  let total  = 0;

  try {
    for (const city of targets) {
      total += await upsertCity(city, conn);
    }
  } finally {
    conn.release();
    await pool.end();
  }

  console.log(`\n✓ Done — ${total} total new rows inserted`);
}

main().catch(err => { console.error(err); process.exit(1); });
