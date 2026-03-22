"use strict";
/**
 * Step 3 — Export contacts with email to CSV.
 *
 * Usage:  node exportContacts.js
 * Output: ./exports/steuerberater-contacts.csv
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const pool = require("./db");

const OUT_DIR  = path.join(__dirname, "exports");
const OUT_FILE = path.join(OUT_DIR, "steuerberater-contacts.csv");

function escape(val) {
  if (val == null) return "";
  return `"${String(val).replace(/"/g, '""')}"`;
}

async function main() {
  const conn   = await pool.getConnection();
  const [rows] = await conn.execute(
    `SELECT name, kanzlei_name, city, email, website
     FROM steuerberater_prospects
     WHERE email IS NOT NULL
     ORDER BY city, kanzlei_name`
  );
  conn.release();
  await pool.end();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = "name,kanzlei_name,city,email,website\n";
  const lines  = rows.map(r =>
    [r.name, r.kanzlei_name, r.city, r.email, r.website].map(escape).join(",")
  );

  fs.writeFileSync(OUT_FILE, header + lines.join("\n") + "\n", "utf8");
  console.log(`✓ Exported ${rows.length} contacts → ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
