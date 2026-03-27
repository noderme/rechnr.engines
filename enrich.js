"use strict";
/**
 * Bulk email enrichment — the single validation gate before any email is sent.
 *
 * Three-pass strategy (cheapest first):
 *   Pass 1 — Format check (free, regex)
 *             → malformed address → mark invalid_email immediately
 *   Pass 2 — MX record check (free, DNS)
 *             → no MX record → mark invalid_email immediately
 *   Pass 3 — ZeroBounce validation
 *             → valid | catch-all → safe to send
 *             → invalid | spamtrap | abuse | do_not_mail → mark invalid_email
 *             → unknown → leave email_status = 'unknown' (send.js will skip)
 *
 * Targets ALL records where:
 *   - email IS NOT NULL
 *   - email_status IS NULL (never validated) OR email_status = 'unknown' (retry)
 *
 * Usage:
 *   node enrich.js              # validate all unvalidated/unknown records
 *   node enrich.js --limit 500  # cap batch size
 *   node enrich.js --dry-run    # preview only, no DB writes
 *   node enrich.js --mx-only    # MX pass only, skip ZeroBounce (free)
 */

require("dotenv").config();
const dns             = require("dns").promises;
const pool            = require("./db");
const { verifyEmail } = require("./zerobounce");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const MX_ONLY = args.includes("--mx-only");

const limitArg = args.indexOf("--limit");
const LIMIT    = limitArg !== -1 ? parseInt(args[limitArg + 1], 10) : 9999;

const SLEEP_MS = 300;

// Statuses safe to send to — everything else is blocked
const SAFE_STATUSES = new Set(["valid", "catch-all"]);

// Basic email format — must have local@domain.tld
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Pass 1: basic format check. */
function isValidFormat(email) {
  return EMAIL_REGEX.test(email.trim());
}

/** Pass 2: domain has at least one MX record. */
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
  console.log(`Batch size: ${LIMIT === 9999 ? "unlimited" : LIMIT}\n`);

  const conn = await pool.getConnection();

  const [rows] = await conn.execute(
    `SELECT id, email, outreach_status
     FROM steuerberater_prospects
     WHERE email IS NOT NULL
       AND (email_status IS NULL OR email_status = 'unknown')
     ORDER BY id ASC
     LIMIT ${LIMIT}`
  );

  console.log(`Found ${rows.length} records to validate\n`);

  if (rows.length === 0) {
    console.log("Nothing to enrich.");
    conn.release();
    await pool.end();
    return;
  }

  let formatFail = 0, mxFail = 0, zbInvalid = 0, zbValid = 0, zbCatchAll = 0, zbUnknown = 0;

  for (const p of rows) {
    process.stdout.write(`[${p.id}] ${p.email} ... `);

    // ── Pass 1: format check ──────────────────────────────────────────────────
    if (!isValidFormat(p.email)) {
      formatFail++;
      if (!DRY_RUN) {
        await conn.execute(
          `UPDATE steuerberater_prospects
           SET email_status = 'invalid', outreach_status = 'invalid_email'
           WHERE id = ?`,
          [p.id]
        );
      }
      console.log("✗ bad format");
      continue;
    }

    // ── Pass 2: MX check ──────────────────────────────────────────────────────
    if (!await hasMxRecord(p.email)) {
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

    // ── Pass 3: ZeroBounce ────────────────────────────────────────────────────
    if (MX_ONLY) {
      console.log("✓ MX ok (ZB skipped)");
      continue;
    }

    const status = await verifyEmail(p.email);

    if (!DRY_RUN) {
      if (SAFE_STATUSES.has(status)) {
        await conn.execute(
          `UPDATE steuerberater_prospects SET email_status = ? WHERE id = ?`,
          [status, p.id]
        );
      } else if (status === "unknown") {
        // Leave outreach_status untouched — send.js will skip unknown
        await conn.execute(
          `UPDATE steuerberater_prospects SET email_status = 'unknown' WHERE id = ?`,
          [p.id]
        );
      } else {
        await conn.execute(
          `UPDATE steuerberater_prospects
           SET email_status = ?, outreach_status = 'invalid_email'
           WHERE id = ?`,
          [status, p.id]
        );
      }
    }

    if (status === "valid")          { zbValid++;    console.log("✓ valid"); }
    else if (status === "catch-all") { zbCatchAll++; console.log("~ catch-all"); }
    else if (status === "unknown")   { zbUnknown++; console.log("? unknown — skipped by sender"); }
    else                             { zbInvalid++; console.log(`✗ ${status}`); }

    await sleep(SLEEP_MS);
  }

  console.log(`
=== Summary ===
  Total processed  : ${rows.length}
  Format fail      : ${formatFail}  → invalid_email
  MX fail          : ${mxFail}      → invalid_email
  ZB invalid/bad   : ${zbInvalid}   → invalid_email
  ZB valid         : ${zbValid}     → safe to send
  ZB catch-all     : ${zbCatchAll}  → safe to send
  ZB unknown       : ${zbUnknown}   → skipped by sender
  ZB skipped (mx-only) : ${MX_ONLY ? rows.length - formatFail - mxFail : 0}
`);

  conn.release();
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
