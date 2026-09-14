// =============================================
// server/lib/validate.js - Input Validation & Sanitization
// =============================================

/**
 * Strips all HTML tags from a string to prevent XSS in PDFs, emails, and DB.
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '')       // strip HTML tags
    .replace(/&/g, '&amp;')        // encode ampersands last
    .trim();
}

/**
 * SSRF Protection: Only allow Google Drive / Docs URLs as receipt links.
 * Blocks internal IPs, cloud metadata endpoints, and arbitrary URLs.
 */
const ALLOWED_RECEIPT_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
];

function validateDriveUrl(url) {
  if (!url) return null; // optional field - null is valid
  try {
    const parsed = new URL(url);
    // Only allow https
    if (parsed.protocol !== 'https:') return null;
    // Only allow allowlisted hosts
    const isAllowed = ALLOWED_RECEIPT_HOSTS.some(host =>
      parsed.hostname === host || parsed.hostname.endsWith('.' + host)
    );
    return isAllowed ? url : null; // return the URL string on success, null on failure
  } catch {
    return null;
  }
}

/**
 * Validates that a value is a positive, finite number.
 */
function isPositiveNumber(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0;
}

/**
 * Validates that a value belongs to an explicit enum.
 */
function isValidEnum(val, allowed) {
  return allowed.includes(val);
}

/**
 * Validates that a value is a canonical UUID (any version/variant).
 * Prevents malformed IDs from reaching Supabase queries.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val) {
  return typeof val === 'string' && UUID_REGEX.test(val);
}

/**
 * Checks that all required fields are present and non-empty.
 * Returns null if valid, or an error message string if not.
 */
function assertRequired(fields) {
  const missing = Object.entries(fields)
    .filter(([, val]) => val === undefined || val === null || val === '')
    .map(([key]) => key);
  if (missing.length > 0) {
    return `Missing required fields: ${missing.join(', ')}`;
  }
  return null;
}

module.exports = {
  sanitizeText,
  validateDriveUrl,
  isPositiveNumber,
  isValidEnum,
  isValidUUID,
  assertRequired,
};
