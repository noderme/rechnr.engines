"use strict";
require("dotenv").config();
const pool = require("./db");

async function migrate() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS steuerberater_prospects (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        kanzlei_name      VARCHAR(255),
        name              VARCHAR(255),
        city              VARCHAR(100),
        website           VARCHAR(255),
        phone             VARCHAR(50),
        email             VARCHAR(255),
        email_verified    BOOLEAN DEFAULT FALSE,
        source            VARCHAR(50) DEFAULT 'steuerberater-suche.de',
        outreach_status   ENUM(
          'pending',
          'email1_sent',
          'email2_sent',
          'email3_sent',
          'replied',
          'unsubscribed',
          'invalid_email'
        ) DEFAULT 'pending',
        email1_sent_at    DATETIME NULL,
        email2_sent_at    DATETIME NULL,
        email3_sent_at    DATETIME NULL,
        replied_at        DATETIME NULL,
        created_at        DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_website (website),
        UNIQUE KEY uq_name_city (kanzlei_name(200), city)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log("✓ Table steuerberater_prospects ready");

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS email_config (
        id                  INT PRIMARY KEY DEFAULT 1,
        current_week        INT DEFAULT 1,
        daily_limit         INT DEFAULT 15,
        emails_sent_today   INT DEFAULT 0,
        last_reset_date     DATE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("✓ Table email_config ready");

    // Insert default row if not present
    await conn.execute(`
      INSERT IGNORE INTO email_config (id, current_week, daily_limit, emails_sent_today, last_reset_date)
      VALUES (1, 1, 10, 0, CURDATE())
    `);
    console.log("✓ email_config defaults set");

    // Add email_status column if not present (ZeroBounce verification result)
    try {
      await conn.execute(`
        ALTER TABLE steuerberater_prospects
        ADD COLUMN email_status VARCHAR(20) NULL DEFAULT NULL
        COMMENT 'ZeroBounce status: valid|invalid|catch-all|unknown|spamtrap|abuse|do_not_mail'
      `);
      console.log("✓ Column email_status added");
    } catch (e) {
      if (e.code === "ER_DUP_FIELDNAME") {
        console.log("✓ Column email_status already exists");
      } else {
        throw e;
      }
    }

    // Add email3_sent_at column if not present
    try {
      await conn.execute(`
        ALTER TABLE steuerberater_prospects
        ADD COLUMN email3_sent_at DATETIME NULL DEFAULT NULL
        AFTER email2_sent_at
      `);
      console.log("✓ Column email3_sent_at added");
    } catch (e) {
      if (e.code === "ER_DUP_FIELDNAME") {
        console.log("✓ Column email3_sent_at already exists");
      } else {
        throw e;
      }
    }

    // Update outreach_status ENUM to include email3_sent
    try {
      await conn.execute(`
        ALTER TABLE steuerberater_prospects
        MODIFY COLUMN outreach_status ENUM(
          'pending',
          'email1_sent',
          'email2_sent',
          'email3_sent',
          'replied',
          'unsubscribed',
          'invalid_email'
        ) DEFAULT 'pending'
      `);
      console.log("✓ outreach_status ENUM updated with 'email3_sent'");
    } catch (e) {
      console.error("✗ Failed to update outreach_status ENUM:", e.message);
      throw e;
    }

    // Add Resend message ID + open/click tracking columns
    const trackingCols = [
      ["resend_email1_id",  "VARCHAR(255) NULL"],
      ["resend_email2_id",  "VARCHAR(255) NULL"],
      ["resend_email3_id",  "VARCHAR(255) NULL"],
      ["email1_opened_at",  "DATETIME NULL"],
      ["email1_clicked_at", "DATETIME NULL"],
      ["email2_opened_at",  "DATETIME NULL"],
      ["email2_clicked_at", "DATETIME NULL"],
      ["email3_opened_at",  "DATETIME NULL"],
      ["email3_clicked_at", "DATETIME NULL"],
    ];
    for (const [col, def] of trackingCols) {
      try {
        await conn.execute(`ALTER TABLE steuerberater_prospects ADD COLUMN ${col} ${def}`);
        console.log(`✓ Column ${col} added`);
      } catch (e) {
        if (e.code === "ER_DUP_FIELDNAME") {
          console.log(`  Column ${col} already exists`);
        } else {
          throw e;
        }
      }
    }

  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
