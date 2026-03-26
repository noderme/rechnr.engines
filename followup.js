"use strict";
/**
 * Step 4b — Follow-up engine (Email 2).
 * Sends Email 2 to prospects where:
 *   - outreach_status = 'email1_sent'
 *   - email1_sent_at was >= 4 days ago
 *   - email2_sent_at IS NULL
 *
 * Usage:
 *   node followup.js           # live
 *   node followup.js --dry-run # preview only
 */

require("dotenv").config();
const { Resend }      = require("resend");
const pool            = require("./db");

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

const resend   = new Resend(process.env.RESEND_API_KEY);
const BASE_URL = process.env.RECHNR_BASE_URL || "https://rechnr.app";
const SLEEP_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

function buildEmail2(prospect) {
  const { name, email } = prospect;
  const greeting = looksLikePersonName(name) ? `Guten Tag ${name.trim()},` : "Guten Tag,";
  const utmParams = "utm_source=cold-email&utm_medium=email&utm_campaign=steuerberater-followup-v2";
  const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&${utmParams}`;

  // Use "Re:" prefix to appear as a reply in the inbox
  const subject = "Re: E-Rechnungspflicht: Wie prüfen Sie die Rechnungen Ihrer Mandanten?";

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>${greeting}</p>

  <p>ich wollte kurz nachhaken, ob Sie schon Gelegenheit hatten, unseren Validator zu testen.</p>

  <p>Ein großes Problem für viele Kanzleien ist aktuell, dass Mandanten weiterhin Word- oder Excel-Vorlagen nutzen wollen. Mit rechnr.app bleibt die Bedienung genauso einfach, aber im Hintergrund wird eine technisch einwandfreie ZUGFeRD-Rechnung (EN 16931) generiert.</p>

  <p>Ihre Vorteile, wenn Mandanten rechnr nutzen:</p>
  <ul style="padding-left: 20px;">
    <li>100% KoSIT-validierte Rechnungen</li>
    <li>Eingebettetes XML wird von DATEV automatisch erkannt</li>
    <li>Keine Rückfragen wegen falscher Formate</li>
  </ul>

  <p>Das Tool ist für Freelancer und Kleinunternehmer komplett kostenlos.</p>

  <p>Darf ich Ihnen in einem kurzen 10-Minuten-Call zeigen, wie einfach das für Ihre Mandanten ist?</p>

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
  console.log("=== Follow-up Sender (Email 2) ===");
  if (DRY_RUN) console.log("DRY RUN — no emails sent");

  const conn = await pool.getConnection();

  // 4-day gap from Email 1
  const [prospects] = await conn.execute(
    `SELECT id, kanzlei_name, name, city, email, email1_sent_at, email_status
     FROM steuerberater_prospects
     WHERE outreach_status = 'email1_sent'
       AND email1_sent_at <= DATE_SUB(NOW(), INTERVAL 4 DAY)
       AND email2_sent_at IS NULL
       AND (email_status IS NULL OR email_status = 'valid')
     ORDER BY email1_sent_at ASC
     LIMIT 15`
  );

  console.log(`Sending follow-ups to ${prospects.length} prospects\n`);

  for (const p of prospects) {
    process.stdout.write(`→ ${p.email} (${p.kanzlei_name}, ${p.city}) ... `);

    const { subject, html } = buildEmail2(p);

    if (DRY_RUN) {
      console.log(`[dry-run] subject: "${subject}"`);
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
          { name: "email_type",  value: "email2" },
        ],
      });

      await conn.execute(
        `UPDATE steuerberater_prospects
         SET outreach_status = 'email2_sent', email2_sent_at = NOW(),
             resend_email2_id = ?
         WHERE id = ?`,
        [result.data?.id ?? null, p.id]
      );
      console.log(`✓ sent (${result.data?.id})`);
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
