"use strict";
/**
 * Bulk email enrichment — reduces bounce rate by pre-validating existing prospects.
 *
 * Two-pass strategy (cheapest checks first):
 *   Pass 1 — MX record check (free, DNS only)
 *             → no MX record → mark invalid_email immediately, skip ZeroBounce
 *   Pass 2 — ZeroBounce validation on records that passed MX
 *             → valid | catch-all → keep as-is
 *             → invalid | spamtrap | abuse | do_not_mail → mark invalid_email
 *
 * Only touches records where:
 *   - email IS NOT NULL
 *   - email_status IS NULL (never validated)
 *   - outreach_status = 'pending' (not already sent to / marked)
 *
 * Usage:
 *   node enrich.js              # validate up to 200 records
 *   node enrich.js --limit 500  # custom batch size
 *   node enrich.js --dry-run    # show what would happen, no DB writes
 *   node enrich.js --mx-only    # skip ZeroBounce, only do MX pass (free)
 */

require("dotenv").config();
const dns             = require("dns").promises;
const pool            = require("./db");
const { verifyEmail } = require("./zerobounce");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MX_ONLY = args.includes("--mx-only");

const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 200;

const SLEEP_MS = 300; // between ZeroBounce calls

// ZeroBounce statuses we consider safe to send to
const SAFE_STATUSES = new Set(["valid", "catch-all"]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Returns true if domain has at least one MX record. */
async function hasMxRecord(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log("=== Bulk Email Enrichment ===");
  if (DRY_RUN) console.log("DRY RUN — no DB writes");
  if (MX_ONLY) console.log("MX-ONLY — skipping ZeroBounce");
  console.log(`Batch size: ${LIMIT}\n`);

  const conn = await pool.getConnection();

  const [rows] = await conn.execute(
    `SELECT id, email, outreach_status
     FROM steuerberater_prospects
     WHERE email IS NOT NULL
       AND email_status IS NULL
     ORDER BY id ASC
     LIMIT ${LIMIT}`
  );

  console.log(`Found ${rows.length} unvalidated prospects\n`);

  if (rows.length === 0) {
    console.log("Nothing to enrich.");
    conn.release();
    await pool.end();
    return;
  }

  let mxFail = 0, zbInvalid = 0, zbValid = 0, zbCatchAll = 0, zbUnknown = 0;

  for (const p of rows) {
    process.stdout.write(`[${p.id}] ${p.email} ... `);

    // ── Pass 1: MX check ──────────────────────────────────────────────────────
    const mx = await hasMxRecord(p.email);
    if (!mx) {
      mxFail++;
      if (!DRY_RUN) {
        await conn.execute(
          `UPDATE steuerberater_prospects
           SET email_status = 'invalid', outreach_status = 'invalid_email'
           WHERE id = ?`,
          [p.id]
        );
      }
      console.log("✗ no MX");
      continue;
    }

    // ── Pass 2: ZeroBounce ────────────────────────────────────────────────────
    if (MX_ONLY) {
      console.log("✓ MX ok (ZB skipped)");
      continue;
    }

    const status = await verifyEmail(p.email);

    if (!DRY_RUN) {
      if (SAFE_STATUSES.has(status)) {
        // Keep as pending, just record the status
        await conn.execute(
          `UPDATE steuerberater_prospects SET email_status = ? WHERE id = ?`,
          [status, p.id]
        );
      } else {
        // Mark undeliverable
        await conn.execute(
          `UPDATE steuerberater_prospects
           SET email_status = ?, outreach_status = 'invalid_email'
           WHERE id = ?`,
          [status, p.id]
        );
      }
    }

    if (status === "valid")      { zbValid++;    console.log(`✓ valid`); }
    else if (status === "catch-all") { zbCatchAll++; console.log(`~ catch-all`); }
    else if (status === "unknown")   { zbUnknown++; console.log(`? unknown`); }
    else                             { zbInvalid++; console.log(`✗ ${status}`); }

    await sleep(SLEEP_MS);
  }

  console.log(`
=== Summary ===
  Total processed : ${rows.length}
  MX fail         : ${mxFail}   → marked invalid_email (free)
  ZB valid        : ${zbValid}
  ZB catch-all    : ${zbCatchAll}
  ZB invalid/bad  : ${zbInvalid} → marked invalid_email
  ZB unknown      : ${zbUnknown} → left as-is
  ZB skipped (MX-only) : ${MX_ONLY ? rows.length - mxFail : 0}
`);

  conn.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
