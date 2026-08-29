/*
 * Structured operational events are safe for platform logs and can also be
 * forwarded to an HTTPS alert receiver. Context is deliberately restricted to
 * identifiers and reason codes; request bodies, tokens and customer data do
 * not belong in an alert.
 */
const ALERT_URL = (process.env.OPERATIONAL_ALERT_WEBHOOK_URL || '').trim();
const SAFE_KEYS = new Set([
    'event_id',
    'event_type',
    'order_id',
    'payment_id',
    'reason',
    'source',
    'status',
    'missing_count',
    'mismatch_count'
]);

function safeContext(details) {
    const result = {};
    for (const [key, value] of Object.entries(details || {})) {
        if (!SAFE_KEYS.has(key) || value === undefined || value === null) continue;
        result[key] = String(value).slice(0, 200);
    }
    return result;
}

async function operationalEvent(name, details, level) {
    const event = {
        type: 'srk_operational_event',
        name: String(name).slice(0, 100),
        level: level || 'error',
        at: new Date().toISOString(),
        context: safeContext(details)
    };

    const line = JSON.stringify(event);
    if (event.level === 'warning') console.warn(line);
    else console.error(line);

    if (!ALERT_URL) return;
    try {
        await fetch(ALERT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: line,
            signal: AbortSignal.timeout(3000)
        });
    } catch (error) {
        console.error(JSON.stringify({
            type: 'srk_operational_alert_delivery_failed',
            at: new Date().toISOString(),
            event: event.name
        }));
    }
}

module.exports = { operationalEvent, safeContext };
