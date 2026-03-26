"use strict";
/**
 * Step 4c — Final follow-up engine (Email 3 — breakup).
 * Sends Email 3 to prospects where:
 *   - outreach_status = 'email2_sent'
 *   - email1_sent_at was >= 9 days ago
 *   - email3_sent_at IS NULL
 *
 * This is the final email in the sequence. Polite breakup — no further emails after this.
 *
 * Usage:
 *   node followup2.js           # live
 *   node followup2.js --dry-run # preview only
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

function buildEmail3(prospect) {
  const { name, email } = prospect;
  const greeting = looksLikePersonName(name) ? `Guten Tag ${name.trim()},` : "Guten Tag,";
  const utmParams = "utm_source=cold-email&utm_medium=email&utm_campaign=steuerberater-breakup-v2";
  const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&${utmParams}`;

  const subject = "Letzter Versuch: E-Rechnungen für Ihre Mandanten";

  const html = `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <p>${greeting}</p>

  <p>da ich bisher nichts von Ihnen gehört habe, gehe ich davon aus, dass das Thema E-Rechnung für Ihre Mandanten aktuell keine Priorität hat oder Sie bereits eine Lösung gefunden haben.</p>

  <p>Falls Sie in Zukunft ein einfaches, kostenloses Tool suchen, das Sie Ihren Freelancern und Kleinunternehmern empfehlen können, behalten Sie <strong><a href="${BASE_URL}?${utmParams}" style="color:#2563eb;">rechnr.app</a></strong> gerne im Hinterkopf.</p>

  <p>Den kostenlosen Validator für ZUGFeRD und XRechnung finden Sie jederzeit hier:<br>
  <a href="${BASE_URL}/validator?${utmParams}" style="color:#2563eb;">rechnr.app/validator</a></p>

  <p>Ich wünsche Ihnen eine erfolgreiche Woche und melde mich nicht weiter.</p>

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
  console.log("=== Final Follow-up Sender (Email 3 — Breakup) ===");
  if (DRY_RUN) console.log("DRY RUN — no emails sent");

  const conn = await pool.getConnection();

  // 9 days after Email 1 (which is ~5 days after Email 2)
  const [prospects] = await conn.execute(
    `SELECT id, kanzlei_name, name, city, email, email1_sent_at, email_status
     FROM steuerberater_prospects
     WHERE outreach_status = 'email2_sent'
       AND email1_sent_at <= DATE_SUB(NOW(), INTERVAL 9 DAY)
       AND email3_sent_at IS NULL
       AND (email_status IS NULL OR email_status = 'valid')
     ORDER BY email1_sent_at ASC
     LIMIT 15`
  );

  console.log(`Sending breakup emails to ${prospects.length} prospects\n`);

  for (const p of prospects) {
    process.stdout.write(`→ ${p.email} (${p.kanzlei_name}, ${p.city}) ... `);

    const { subject, html } = buildEmail3(p);

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
          { name: "email_type",  value: "email3" },
        ],
      });

      await conn.execute(
        `UPDATE steuerberater_prospects
         SET outreach_status = 'email3_sent', email3_sent_at = NOW(),
             resend_email3_id = ?
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
