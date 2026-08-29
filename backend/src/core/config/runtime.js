/*
 * Production configuration is validated once at boot. A missing value must
 * stop a deployment rather than leave a partly working checkout online.
 */
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

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
