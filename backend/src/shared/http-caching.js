/*
 * shared/http-caching.js
 * ============================================================================
 *
 * The one Cache-Control string for an anonymous, read-only response that is
 * safe to sit in a shared cache for a little while — today, the public
 * catalogue (products, categories). Nothing under checkout/cart/account/
 * orders/payments should ever import this: those already set their own
 * `no-store, no-cache, must-revalidate, proxy-revalidate` for a reason, and a
 * shared cache serving one visitor's checkout state to the next is exactly
 * the failure that header exists to rule out.
 *
 *   public            any cache along the way — not just the visitor's own
 *                      browser — may store and reuse this response.
 *   max-age=30        a BROWSER treats its own copy as fresh for 30s.
 *   s-maxage=300       a SHARED cache (CDN, reverse proxy) may serve its copy
 *                      for 5 minutes before revalidating — longer than the
 *                      browser figure because a shared cache answers many
 *                      visitors from the one copy, so a few minutes of
 *                      staleness buys a much larger cut in origin requests.
 *   stale-while-revalidate=600
 *                      for 10 minutes past that, a cache may serve the stale
 *                      copy immediately while it revalidates in the
 *                      background, so a request landing right after
 *                      expiry is never made to wait on it.
 *
 * THE ETAG ITSELF IS NOT HERE. Express's own default (`app.get('etag')` is
 * `'weak'` unless something turns it off, and nothing in this app does — see
 * core/http/static-files.js for the one place a cache header is chosen by
 * hand, and it is not this) already computes a weak ETag from the exact
 * bytes of every JSON response and answers a matching If-None-Match with a
 * bodyless 304 before the route handler's `res.json()` call even returns —
 * see `if (req.fresh) this.status(304)` in express/lib/response.js. Writing
 * that by hand here would be a second, easier-to-get-wrong copy of a check
 * the framework already gets right, including the parts a quick
 * implementation tends to miss (a comma-separated If-None-Match, `*`, weak
 * comparison). This file only adds what Express does not already supply on
 * its own: permission for a cache other than the visitor's browser to keep a
 * copy at all.
 */

const SHARED_READ_CACHE = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600';

module.exports = { SHARED_READ_CACHE };
