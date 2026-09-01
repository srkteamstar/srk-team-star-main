/*
 * Production configuration is validated once at boot. A missing value must
 * stop a deployment rather than leave a partly working checkout online.
 */
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

// Mirrors core/http/page-metadata.js's siteOrigin() acceptance rule exactly —
// duplicated on purpose rather than imported, so a config-boot check has no
// dependency on a module that scans the pages directory as a side effect of
// being required. THE TWO MUST AGREE, or a value that passes here could still
// be silently rejected there. Without a boot check, an absent or malformed
// SITE_ORIGIN was never a startup failure: siteOrigin() just returns '' at
// render time, so canonical/og:url tags quietly vanish from every page and
// GET /sitemap.xml quietly starts answering 503 — both are silent in
// production, which is the finding this closes.
function validSiteOrigin(value) {
    try {
        const url = new URL(value || '');
        if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return false;
        if (url.hostname === 'localhost' || /^(?:127\.|0\.|\[::1\])/.test(url.hostname)) return false;
        return true;
    } catch (error) {
        return false;
    }
}

function configuredOrigins() {
    return (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

function assertProductionConfig() {
    const problems = [];

    try {
        const url = new URL(process.env.SUPABASE_URL || '');
        if (isProduction && url.protocol !== 'https:') problems.push('SUPABASE_URL must use HTTPS.');
    } catch (error) {
        problems.push('SUPABASE_URL must be a valid URL.');
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        problems.push('SUPABASE_SERVICE_ROLE_KEY is required.');
    }

    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < (isProduction ? 48 : 32)) {
        problems.push(`SESSION_SECRET must contain at least ${isProduction ? 48 : 32} characters.`);
    }

    const seen = new Set();
    for (const origin of configuredOrigins()) {
        try {
            const parsed = new URL(origin);
            if (parsed.origin !== origin || (isProduction && parsed.protocol !== 'https:')) {
                problems.push(`ALLOWED_ORIGINS entry must be an exact${isProduction ? ' HTTPS' : ''} origin: ${origin}`);
            }
            if (seen.has(parsed.origin)) problems.push(`ALLOWED_ORIGINS contains a duplicate: ${parsed.origin}`);
            seen.add(parsed.origin);
        } catch (error) {
            problems.push(`ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
        }
    }

    // Gated on isProduction, the same flag every other check in this function
    // uses — not PAYMENTS_ENABLED, which only asks whether the Razorpay
    // gateway is switched on and says nothing about whether this process is
    // actually serving the public site. SEO/canonical correctness matters to
    // every production deployment regardless of whether online payment is
    // enabled for it, so it is validated here rather than in
    // core/config/payments.js. Dev/test stay untouched: isProduction is false
    // there, so SITE_ORIGIN remains optional and a test may keep injecting
    // its own, exactly as before.
    if (isProduction && !validSiteOrigin(process.env.SITE_ORIGIN)) {
        problems.push('SITE_ORIGIN must be a confirmed HTTPS origin with no path, query or fragment (e.g. https://www.example.com) — required in production because canonical/og:url tags and /sitemap.xml depend on it.');
    }

    const alertUrl = (process.env.OPERATIONAL_ALERT_WEBHOOK_URL || '').trim();
    if (alertUrl) {
        try {
            const parsed = new URL(alertUrl);
            if (parsed.protocol !== 'https:') problems.push('OPERATIONAL_ALERT_WEBHOOK_URL must use HTTPS.');
        } catch (error) {
            problems.push('OPERATIONAL_ALERT_WEBHOOK_URL must be a valid HTTPS URL.');
        }
    }

    if (problems.length) {
        throw new Error(`Production configuration is invalid:\n- ${problems.join('\n- ')}`);
    }
}

module.exports = { isProduction, configuredOrigins, assertProductionConfig };
