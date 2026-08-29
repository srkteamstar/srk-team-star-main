/*
 * core/http/private-paths.js — the deny list, kept after the tiers were split
 * ============================================================================
 *
 * IN `#1` THIS WAS LOAD-BEARING. `express.static` served the whole project
 * directory and `backend/` sat inside it, so `/backend/server.js`,
 * `/backend/package.json` and every file under `/backend/migrations/` were
 * readable by anyone who asked. This regex was the only thing refusing them.
 *
 * IT IS NOT LOAD-BEARING ANY MORE, AND IT STAYS ANYWAY. The mounts in
 * core/config/static-mounts.js serve `frontend/` and nothing else — the
 * backend is not under a served root at any depth, so there is no path a
 * request can spell that reaches it. That is a stronger guarantee than a deny
 * list, because it cannot be defeated by a pattern nobody thought of.
 *
 * Keeping the guard costs one regex per request and buys two things. It still
 * refuses the extensions (`.md`, `.sql`, `.env`, `.log`) wherever they may end
 * up under `frontend/` — a stray note dropped into the assets tree is denied
 * without anyone having to notice it. And it keeps the X-Robots-Tag rule,
 * which was never about privacy in the first place.
 */
// PRIVATE PATHS
//
// express.static below serves the whole project root, and `backend/` sits
// inside it — so /backend/server.js, /backend/package.json and every file in
// /backend/migrations/ were being served to anyone who asked. That is source
// and schema disclosure: server.js states the table names, the validation
// rules and how roles are resolved, package.json names
// every dependency and version for CVE matching, and the migrations are the
// full schema.
//
// backend/.env was never exposed — serve-static ignores dotfiles by default —
// but that is one default standing between a service-role key and the world,
// which is not a margin worth keeping.
//
// A deny list rather than an allow list, deliberately: there is no build step
// here, the public site is an open-ended set of .html/.js/.css/asset files at
// the root, and an allow list would silently 404 the next page someone adds.
// This blocks what must never be public and leaves the site alone.
// `.txt` joined the extension list, which is not tidying. Every
// assets/products/<Name>/INFO.txt is an internal note and at least one of
// them reads `price:- 55,000rs` — a figure for a product the catalogue
// publishes as "On request", i.e. a price the business has decided not to
// state. Nothing in the site loads these files; they were reachable purely
// because they sat under a served directory.
//
// Root scratch that was also being served and is referenced by nothing:
// filter-tab.txt (a 6kb markup draft, covered by the .txt rule) and
// `locator`, an empty extensionless stub that answered 200.
//
// ALLOW_PUBLIC is the narrow hole kept open on purpose, so that adding a
// robots.txt or a well-known file later does not require rediscovering this
// regex. Nothing matches it today.
const PRIVATE_PATH = /(^|\/)(backend|node_modules)(\/|$)|\.(md|sql|prompt|env|log|bak|db|sqlite|txt|ini|yml|yaml|lock)$/i;

const PRIVATE_EXACT = new Set(['/locator']);

const ALLOW_PUBLIC = /^\/(robots\.txt|ads\.txt|sitemap\.xml|\.well-known\/[\w.-]+)$/i;

function privatePathGuard(req, res, next) {
    // decodeURIComponent so %2e%2e and friends cannot smuggle a segment past
    // the test; a malformed escape is itself reason enough to refuse.
    let pathname;
    try {
        pathname = decodeURIComponent(req.path);
    } catch (error) {
        return res.status(400).send('Bad request');
    }

    if (ALLOW_PUBLIC.test(pathname)) return next();

    if (PRIVATE_PATH.test(pathname) || PRIVATE_EXACT.has(pathname.toLowerCase())) {
        // 404, not 403: "this does not exist" tells an attacker less than
        // "this exists and you may not have it".
        return res.status(404).send('Not found');
    }

    // KEEP THESE OUT OF SEARCH RESULTS
    //
    // A checkout is not something that should turn up in a search result,
    // and a crawled URL is a URL somebody else's tooling now knows about.
    // Nothing is protected BY this — the page is harmless to fetch and every
    // route behind it is enforced server-side — but noindex on the response is
    // the half a crawler cannot ignore by asking for the page anyway, which
    // robots.txt is not.
    if (/^\/(store\/(?:checkout|payment)\.html)$/i.test(pathname)) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }

    next();
}

module.exports = { privatePathGuard, PRIVATE_PATH, PRIVATE_EXACT, ALLOW_PUBLIC };
