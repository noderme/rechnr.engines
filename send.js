"use strict";
/**
 * Step 4 — Cold email engine (Email 1).
 * Daily limit ramps up week-by-week from email_config table:
 *   Week 1 = 15, Week 2 = 20, Week 3 = 30, Week 4+ = 50
 *
 * Usage:
 *   node send.js           # live
 *   node send.js --dry-run # preview only
 */

require("dotenv").config();
const { Resend } = require("resend");
const pool       = require("./db");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const resend   = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.RECHNR_BASE_URL || "https://rechnr.app";
const SLEEP_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Get current config row — initialises row if missing. */
async function getConfig(conn) {
  const [rows] = await conn.execute(`SELECT * FROM email_config WHERE id = 1`);
  if (rows.length > 0) return rows[0];

  // First run — insert defaults
  await conn.execute(`
    INSERT INTO email_config (id, current_week, daily_limit, emails_sent_today, last_reset_date)
    VALUES (1, 1, 15, 0, CURDATE())
  `);
  const [r] = await conn.execute(`SELECT * FROM email_config WHERE id = 1`);
  return r[0];
}

/** Increment emails_sent_today counter. */
async function incrementSentToday(conn, count) {
  await conn.execute(
    `UPDATE email_config SET emails_sent_today = emails_sent_today + ? WHERE id = 1`,
    [count]
  );
}

function buildEmail1(prospect) {
  const { name, email } = prospect;
  const greeting = name ? `Sehr geehrte/r ${name},` : "Sehr geehrte Damen und Herren,";
  const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}`;

  const subject = "Ihre Mandanten & E-Rechnungspflicht ab 2027 – kostenloses Tool + Provision";

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>${greeting}</p>

  <p>ab Januar 2027 müssen alle deutschen Unternehmen mit einem Jahresumsatz über 800.000 € E-Rechnungen ausstellen – ab 2028 gilt dies für <strong>alle</strong>.</p>

  <p>Ich habe <strong><a href="${BASE_URL}" style="color:#2563eb;">rechnr.app</a></strong> entwickelt: das einzige kostenlose Tool das Rechnungen in Echtzeit mit dem <strong>offiziellen KoSIT-Validator der Bundesregierung</strong> prüft — demselben Tool das DATEV und Behörden verwenden.</p>

  <p>Für jeden Ihrer Mandanten der rechnr.app als Business-Kunde nutzt erhalten Sie dauerhaft <strong>5 € pro Monat</strong>.</p>

  <p>Darf ich es Ihnen kurz vorstellen? Antworten Sie einfach auf diese E-Mail — ich melde mich innerhalb von 24 Stunden.</p>

  <p style="margin-top:32px;">Mit freundlichen Grüßen,<br>
  <strong>${process.env.RESEND_FROM_NAME}</strong><br>
  <a href="${BASE_URL}" style="color:#2563eb;">rechnr.app</a></p>

  <hr style="border:none; border-top:1px solid #eee; margin-top:40px;">
  <p style="font-size:11px; color:#999;">
    Sie erhalten diese E-Mail, da Ihre Kanzlei auf steuerberater-suche.de gelistet ist.<br>
    <a href="${unsubUrl}" style="color:#999;">Abmelden</a>
  </p>

</body>
</html>`;

  return { subject, html };
}

async function main() {
  console.log("=== Cold Email Sender (Email 1) ===");
  if (DRY_RUN) console.log("DRY RUN — no emails sent");

  const conn   = await pool.getConnection();
  const config = await getConfig(conn);

  const { daily_limit, emails_sent_today, current_week } = config;
  const remaining = Number(daily_limit) - Number(emails_sent_today);

  console.log(`Week ${current_week} | Daily limit: ${daily_limit} | Sent today: ${emails_sent_today} | Remaining: ${remaining}`);

  if (remaining <= 0) {
    console.log("Daily limit reached — try again tomorrow");
    conn.release();
    await pool.end();
    return;
  }

  const [prospects] = await conn.execute(
    `SELECT id, kanzlei_name, name, city, email
     FROM steuerberater_prospects
     WHERE email IS NOT NULL
       AND outreach_status = 'pending'
     ORDER BY id ASC
     LIMIT ${Math.floor(remaining)}`
  );

  console.log(`Sending to ${prospects.length} prospects\n`);

  let sent = 0;
  for (const p of prospects) {
    const { subject, html } = buildEmail1(p);
    process.stdout.write(`→ ${p.email} (${p.kanzlei_name}, ${p.city}) ... `);

    if (DRY_RUN) {
      console.log(`[dry-run] "${subject}"`);
      continue;
    }

    try {
      await resend.emails.send({
        from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
        to:   p.email,
        subject,
        html,
      });

      await conn.execute(
        `UPDATE steuerberater_prospects
         SET outreach_status = 'email1_sent', email1_sent_at = NOW()
         WHERE id = ?`,
        [p.id]
      );
      sent++;
      console.log("✓");
    } catch (err) {
      console.error(`✗ ${err.message}`);
    }

    await sleep(SLEEP_MS);
  }

  if (!DRY_RUN && sent > 0) {
    await incrementSentToday(conn, sent);
  }

  conn.release();
  await pool.end();
  console.log(`\n=== Done — ${sent} sent ===`);
}

main().catch(err => { console.error(err); process.exit(1); });
