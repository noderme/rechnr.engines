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
          'replied',
          'unsubscribed'
        ) DEFAULT 'pending',
        email1_sent_at    DATETIME NULL,
        email2_sent_at    DATETIME NULL,
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

  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch(err => { console.error(err); process.exit(1); });
