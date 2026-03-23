"use strict";
/**
 * Reoon email verification helper.
 * Calls the Reoon single-address verify API and returns the status string.
 *
 * Possible statuses: valid | invalid | catch_all | disposable | spamtrap | unknown
 * Only 'valid' should be sent to.
 *
 * Docs: https://emailverifier.reoon.com/docs/
 */

require("dotenv").config();
const axios = require("axios");

const API_KEY = process.env.REOON_API_KEY;

/**
 * Verify a single email address via Reoon.
 * Returns the status string, or 'unknown' on error.
 */
async function verifyEmail(email) {
  if (!API_KEY) {
    console.warn("[Reoon] REOON_API_KEY not set — skipping verification");
    return "unknown";
  }

  try {
    const { data } = await axios.get("https://emailverifier.reoon.com/api/v1/verify", {
      params: { email, key: API_KEY, mode: "quick" },
      timeout: 10_000,
    });
    return (data.status || "unknown").toLowerCase();
  } catch (err) {
    console.error(`[Reoon] Error verifying ${email}: ${err.message}`);
    return "unknown";
  }
}

module.exports = { verifyEmail };
