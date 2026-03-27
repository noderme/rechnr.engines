"use strict";
/**
 * Step 4 — Cold email engine (Email 1).
 * Daily limit ramps up week-by-week from email_config table:
 *   Week 1 = 10, Week 2 = 15, Week 3 = 20, Week 4+ = 50
 *
 * Usage:
 *   node send.js           # live
 *   node send.js --dry-run # preview only
 */

require("dotenv").config();
const { Resend }      = require("resend");
const dns             = require("dns").promises;
const pool            = require("./db");
const { verifyEmail } = require("./zerobounce");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const resend   = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.RECHNR_BASE_URL || "https://rechnr.app";
const SLEEP_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Returns true if the email's domain has at least one MX record. */
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

/** Get current config row — initialises row if missing. */
async function getConfig(conn) {
  const [rows] = await conn.execute(`SELECT * FROM email_config WHERE id = 1`);
  if (rows.length > 0) return rows[0];

  // First run — insert defaults
  await conn.execute(`
    INSERT INTO email_config (id, current_week, daily_limit, emails_sent_today, last_reset_date)
    VALUES (1, 1, 10, 0, CURDATE())
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

/** Simple heuristic: treat as person name only if it's 2-3 short words with no company keywords. */
function looksLikePersonName(n) {
  if (!n || typeof n !== "string") return false;
  const s = n.trim();
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  const companyHints = /steuerber|kanzlei|partner|gmbh|gbr|&|gesellschaft|büro|beratung|consulting|treuhand|wirtschafts/i;
  if (companyHints.test(s)) return false;
  return true;
}

function buildEmail1(prospect) {
  const { name, email } = prospect;
  const greeting = looksLikePersonName(name) ? `Guten Tag ${name.trim()},` : "Guten Tag,";
  const utmParams = "utm_source=cold-email&utm_medium=email&utm_campaign=steuerberater-outreach-v2";
  const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&${utmParams}`;

  const subject = "E-Rechnungspflicht 2027 – kennen Ihre Mandanten das Problem?";

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>${greeting}</p>

  <p>viele Ihrer Mandanten werden ab 2027 E-Rechnungen ausstellen müssen — aber die meisten wissen noch nicht, dass eine normale PDF dafür nicht ausreicht.</p>

  <p>Das häufigste Problem: Mandanten exportieren aus Lexoffice oder sevDesk im falschen Profil (BASIC statt EN 16931) und merken es erst, wenn eine Rechnung abgelehnt wird.</p>

  <p>Wir haben <strong><a href="${BASE_URL}?${utmParams}" style="color:#2563eb;">rechnr.app</a></strong> gebaut — ein kostenloses Tool das konforme ZUGFeRD 2.3 Rechnungen erstellt und jede Rechnung automatisch mit dem offiziellen KoSIT-Validator der Bundesregierung prüft. DATEV-kompatibel, direkt einsatzbereit.</p>

  <p>Falls Sie Ihren Mandanten eine fertige Lösung empfehlen möchten — den Validator können Sie kostenlos selbst testen:<br>
  <a href="${BASE_URL}/validator?${utmParams}" style="color:#2563eb;">rechnr.app/validator</a></p>

  <p style="margin-top:32px;">Mit freundlichen Grüßen,<br>
  <strong>Das rechnr Team</strong><br>
  <a href="${BASE_URL}?${utmParams}" style="color:#2563eb;">rechnr.app</a></p>

  <hr style="border:none; border-top:1px solid #eee; margin-top:40px;">
  <p style="font-size:11px; color:#999;">
    Sie erhalten diese E-Mail, da Ihre Kanzlei öffentlich gelistet ist.<br>
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
    `SELECT id, kanzlei_name, name, city, email, email_status
     FROM steuerberater_prospects
     WHERE email IS NOT NULL
       AND outreach_status = 'pending'
     ORDER BY id ASC
     LIMIT ${Math.floor(remaining)}`
  );

  console.log(`Sending to ${prospects.length} prospects\n`);

  let sent = 0;
  for (const p of prospects) {
    process.stdout.write(`→ ${p.email} (${p.kanzlei_name}, ${p.city}) ... `);

    // MX record check — skip immediately if domain has no mail server
    if (!await hasMxRecord(p.email)) {
      await conn.execute(
        `UPDATE steuerberater_prospects SET email_status = 'invalid', outreach_status = 'invalid_email' WHERE id = ?`,
        [p.id]
      );
      console.log(`[skip] No MX record → marked invalid_email`);
      await sleep(SLEEP_MS);
      continue;
    }

    // Verify email if not already done
    if (p.email_status === null || p.email_status === undefined) {
      const status = await verifyEmail(p.email);
      if (status !== "valid") {
        await conn.execute(
          `UPDATE steuerberater_prospects SET email_status = ?, outreach_status = 'invalid_email' WHERE id = ?`,
          [status, p.id]
        );
        console.log(`[skip] ZeroBounce: ${status} → marked invalid_email`);
        await sleep(SLEEP_MS);
        continue;
      }
      await conn.execute(
        `UPDATE steuerberater_prospects SET email_status = 'valid' WHERE id = ?`,
        [p.id]
      );
      p.email_status = "valid";
    }

    const { subject, html } = buildEmail1(p);

    if (DRY_RUN) {
      console.log(`[dry-run] "${subject}"`);
      continue;
    }

    try {
      const result = await resend.emails.send({
        from: `${process.env.RESEND_FROM_NAME} <${process.env.RESEND_FROM_EMAIL}>`,
        to:   p.email,
        subject,
        html,
        tags: [
          { name: "prospect_id", value: String(p.id) },
          { name: "email_type",  value: "email1" },
        ],
      });

      await conn.execute(
        `UPDATE steuerberater_prospects
         SET outreach_status = 'email1_sent', email1_sent_at = NOW(),
             resend_email1_id = ?
         WHERE id = ?`,
        [result.data?.id ?? null, p.id]
      );
      sent++;
      console.log(`✓ (${result.data?.id})`);
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
