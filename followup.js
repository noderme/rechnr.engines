"use strict";
/**
 * Step 4b — Follow-up engine (Email 2).
 * Sends Email 2 to prospects where:
 *   - outreach_status = 'email1_sent'
 *   - email1_sent_at was >= 5 days ago
 *   - email2_sent_at IS NULL
 *
 * Usage:
 *   node followup.js           # live
 *   node followup.js --dry-run # preview only
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

function buildEmail2(prospect) {
  const { name, email } = prospect;
  const greeting = name ? `Sehr geehrte/r ${name},` : "Sehr geehrte Damen und Herren,";
  const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}`;

  const subject = "Kurze Nachfrage – rechnr.app für Ihre Mandanten";

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>${greeting}</p>

  <p>kurze Nachfrage zu meiner E-Mail von letzter Woche.</p>

  <p>Viele Ihrer Mandanten werden Sie bald fragen: <em>Was muss ich wegen der E-Rechnungspflicht tun?</em></p>

  <p>Mit <strong><a href="${BASE_URL}" style="color:#2563eb;">rechnr.app</a></strong> haben Sie eine fertige Antwort — kostenlos für Freiberufler, und Sie verdienen <strong>5 €/Monat</strong> für jeden Business-Kunden.</p>

  <p><a href="${BASE_URL}" style="color:#2563eb;">→ rechnr.app</a></p>

  <p style="margin-top:32px;">Mit freundlichen Grüßen,<br>
  <strong>${process.env.RESEND_FROM_NAME}</strong><br>
  <a href="${BASE_URL}" style="color:#2563eb;">rechnr.app</a></p>

  <hr style="border:none; border-top:1px solid #eee; margin-top:40px;">
  <p style="font-size:11px; color:#999;">
    <a href="${unsubUrl}" style="color:#999;">Abmelden</a>
  </p>

</body>
</html>`;

  return { subject, html };
}

async function main() {
  console.log("=== Follow-up Sender (Email 2) ===");
  if (DRY_RUN) console.log("DRY RUN — no emails sent");

  const conn = await pool.getConnection();

  const [prospects] = await conn.execute(
    `SELECT id, kanzlei_name, name, city, email
     FROM steuerberater_prospects
     WHERE outreach_status = 'email1_sent'
       AND email1_sent_at <= DATE_SUB(NOW(), INTERVAL 5 DAY)
       AND email2_sent_at IS NULL
     ORDER BY email1_sent_at ASC
     LIMIT 15`
  );

  console.log(`Sending follow-ups to ${prospects.length} prospects\n`);

  for (const p of prospects) {
    const { subject, html } = buildEmail2(p);
    process.stdout.write(`→ ${p.email} (${p.kanzlei_name}, ${p.city}) ... `);

    if (DRY_RUN) {
      console.log(`[dry-run] subject: "${subject}"`);
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
         SET outreach_status = 'email2_sent', email2_sent_at = NOW()
         WHERE id = ?`,
        [p.id]
      );
      console.log("✓ sent");
    } catch (err) {
      console.error(`✗ ${err.message}`);
    }

    await sleep(SLEEP_MS);
  }

  conn.release();
  await pool.end();
  console.log("\n=== Done ===");
}

main().catch(err => { console.error(err); process.exit(1); });
