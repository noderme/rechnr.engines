"use strict";
/**
 * Orchestrator — mirrors RootCanal index.js logic exactly.
 *
 * Schedule (Europe/Berlin):
 *   00:00 daily     → reset daily email counter; advance week on Mondays
 *   02:00 daily     → scraper.js (one zip) — self-throttles to every 2 days
 *                     → findEmails.js for the active city's new leads
 *   09:00 Tue+Wed   → send.js (Email 1, ramping daily limit)
 *   09:15 Tue+Wed   → followup.js (Email 2, 5-day follow-up)
 *
 * Usage:
 *   node index.js
 *   node index.js --dry-run
 *   pm2 start pm2.config.js
 */

require("dotenv").config();
const cron   = require("node-cron");
const { spawn } = require("child_process");
const fs     = require("fs");
const path   = require("path");
const pool   = require("./db");
const http   = require("http");

const DRY_RUN    = process.argv.includes("--dry-run");
const TZ         = "Asia/Kolkata";

const DATA_DIR        = process.env.DATA_DIR || __dirname;
const STATE_FILE      = path.join(DATA_DIR, "locations_state.json");
const LAST_SCRAPE_FILE = path.join(DATA_DIR, "last_scrape.json");

// Week → daily limit mapping
const WEEK_LIMITS = { 1: 10, 2: 15, 3: 20, 4: 30 };
const DEFAULT_LIMIT = 50; // week 5+

function weekLimit(week) {
  return WEEK_LIMITS[week] ?? DEFAULT_LIMIT;
}

// ─── STATE HELPERS ────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

/** Returns the city of the most recently scraped location (for upsert + findEmails). */
function getLastScrapedCity(state) {
  if (!state) return null;
  // Find the last entry that was scraped (most recent scrape)
  const scraped = state.filter(l => l.scraped);
  if (scraped.length === 0) return null;
  return scraped[scraped.length - 1];
}

/** Returns true if 2+ days have passed since last scrape. */
function shouldScrapeToday() {
  if (!fs.existsSync(LAST_SCRAPE_FILE)) return true;
  try {
    const { lastScrapeAt } = JSON.parse(fs.readFileSync(LAST_SCRAPE_FILE, "utf8"));
    const daysSince = (Date.now() - new Date(lastScrapeAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 2;
  } catch {
    return true;
  }
}

// ─── RUN HELPER ───────────────────────────────────────────────────────────────

function run(script, args = [], label) {
  return new Promise(resolve => {
    console.log(`\n[${label}] node ${script} ${args.join(" ")}`);
    const child = spawn("node", [path.join(__dirname, script), ...args], {
      stdio: "inherit",
    });
    child.on("close", code => {
      console.log(`[${label}] exited ${code}`);
      resolve(code);
    });
    child.on("error", err => {
      console.error(`[${label}] error: ${err.message}`);
      resolve(1);
    });
  });
}

// ─── JOBS ─────────────────────────────────────────────────────────────────────

async function runScrapeAndEnrich() {
  if (!shouldScrapeToday()) {
    console.log(`\n[SCRAPE] Less than 2 days since last scrape — skipping.`);
    return;
  }

  const scrapeArgs = DRY_RUN ? ["--dry-run"] : [];
  await run("scraper.js", scrapeArgs, "SCRAPE");

  // Find which city was just updated and find emails for its new leads
  const state  = loadState();
  const target = getLastScrapedCity(state);

  if (!target) {
    console.log(`\n[UPSERT] No city in progress.`);
  } else {
    // 1. Insert new JSON leads into MySQL in order
    console.log(`\n[UPSERT] Inserting ${target.city} leads into MySQL...`);
    const upsertArgs = ["--city", target.city];
    if (DRY_RUN) upsertArgs.push("--dry-run");
    await run("upsert.js", upsertArgs, `UPSERT ${target.city}`);

    // 2. Find emails for rows that have website but no email yet
    console.log(`\n[EMAILS] Finding emails for ${target.city}...`);
    const emailArgs = ["--city", target.city, "--limit", "50"];
    if (DRY_RUN) emailArgs.push("--dry-run");
    await run("findEmails.js", emailArgs, `EMAILS ${target.city}`);
  }
}

async function runSend() {
  const args = DRY_RUN ? ["--dry-run"] : [];
  await run("send.js", args, "SEND");
}

async function runFollowup() {
  const args = DRY_RUN ? ["--dry-run"] : [];
  await run("followup.js", args, "FOLLOWUP");
}

/** Midnight: reset daily counter. Advance week on Mondays. */
async function midnightReset() {
  const conn = await pool.getConnection();
  try {
    const isMonday = new Date().getDay() === 1;
    const [rows]   = await conn.execute(`SELECT * FROM email_config WHERE id = 1`);
    if (rows.length === 0) return;

    const newWeek  = isMonday ? rows[0].current_week + 1 : rows[0].current_week;
    const newLimit = weekLimit(newWeek);

    await conn.execute(
      `UPDATE email_config
       SET emails_sent_today = 0, last_reset_date = CURDATE(),
           current_week = ?, daily_limit = ?
       WHERE id = 1`,
      [newWeek, newLimit]
    );

    console.log(
      `[midnight] Reset done.` +
      (isMonday ? ` Week → ${newWeek} | Limit → ${newLimit}/day` : "")
    );
  } catch (err) {
    console.error(`[midnight] ${err.message}`);
  } finally {
    conn.release();
  }
}

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────

function schedule() {
  // 00:00 IST daily — reset counter + advance week on Mondays
  cron.schedule("0 0 * * *", midnightReset, { timezone: TZ });
  console.log("  Scheduled: 00:00 IST daily → midnight reset");

  // 10:00 IST daily — scrape one location + find emails
  cron.schedule("0 10 * * *", runScrapeAndEnrich, { timezone: TZ });
  console.log("  Scheduled: 10:00 IST daily → scraper + findEmails");

  // 10:15 IST daily — send Email 1
  cron.schedule("15 10 * * *", runSend, { timezone: TZ });
  console.log("  Scheduled: 10:15 IST daily → send Email 1");

  // 10:30 IST daily — send Email 2 follow-up
  cron.schedule("30 10 * * *", runFollowup, { timezone: TZ });
  console.log("  Scheduled: 10:30 IST daily → followup Email 2");
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const state = loadState();

  const daysSinceScrape = (() => {
    if (!fs.existsSync(LAST_SCRAPE_FILE)) return "never";
    try {
      const { lastScrapeAt } = JSON.parse(fs.readFileSync(LAST_SCRAPE_FILE, "utf8"));
      return `${((Date.now() - new Date(lastScrapeAt).getTime()) / (1000 * 60 * 60 * 24)).toFixed(1)} days ago`;
    } catch { return "unknown"; }
  })();

  const lastCity    = getLastScrapedCity(state);
  const totalLocs   = state ? state.length : 0;
  const doneLocs    = state ? state.filter(l => l.scraped).length : 0;

  console.log(`\n=== Steuerberater Orchestrator ===`);
  console.log(`   Mode         : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`   Progress     : ${doneLocs} / ${totalLocs} locations scraped`);
  console.log(`   Last city    : ${lastCity?.city ?? "none"}`);
  console.log(`   Last scrape  : ${daysSinceScrape}`);
  console.log(`   Next email   : Daily 10:15 IST\n`);

  schedule();

  const PORT = process.env.OUTREACH_PORT || 3001;
  http.createServer((_, res) => res.end("ok")).listen(PORT, () => {
    console.log(`✅ Running. Health check on :${PORT}\n`);
  });
}

main().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
