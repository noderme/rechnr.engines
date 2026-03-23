"use strict";
/**
 * ZeroBounce email verification helper.
 * Calls the ZeroBounce single-address validate API and returns the status string.
 *
 * Possible statuses: valid | invalid | catch-all | unknown | spamtrap | abuse | do_not_mail
 * Only 'valid' should be sent to.
 *
 * Docs: https://www.zerobounce.net/docs/email-validation-api-quickstart/
 */

require("dotenv").config();
const axios = require("axios");

const API_KEY = process.env.ZEROBOUNCE_API_KEY;

/**
 * Verify a single email address via ZeroBounce.
 * Returns the status string, or 'unknown' on error.
 */
async function verifyEmail(email) {
  if (!API_KEY) {
    console.warn("[ZeroBounce] ZEROBOUNCE_API_KEY not set — skipping verification");
    return "unknown";
  }

  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(API_KEY)}&email=${encodeURIComponent(email)}&ip_address=`;
    const { data } = await axios.get(url, { timeout: 10_000 });
    return (data.status || "unknown").toLowerCase();
  } catch (err) {
    console.error(`[ZeroBounce] Error verifying ${email}: ${err.message}`);
    return "unknown";
  }
}

module.exports = { verifyEmail };
