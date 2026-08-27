/*
 * core/http/not-found.js — every /api path no module claimed
 * ============================================================================
 *
 * Mounted last in main.js, after every module's router, so it only ever sees
 * what nothing declared.
 */
// ==========================================
// DEFAULT DENY — every /api path not declared above
// ==========================================
//
// Registered after every route, so it only ever sees what nothing claimed.
//
// Two things were wrong with letting these fall through to the static
// handler and then to Express's finalhandler. It answered an API call with
// an HTML error document, so a client parsing JSON got a syntax error rather
// than a status it could act on; and the body echoed the method and path
// back ("Cannot GET /api/whatever"), which turns the 404 into a confirmation
// oracle for probing route shapes.
//
// A fixed JSON body says nothing about what does exist. It is also what a
// route deleted in future falls through to, rather than becoming a silent
// hole: asking for one gets exactly the answer that asking for something
// which never existed gets.
function apiNotFound(req, res) {
    res.status(404).json({ error: "Not found." });
}

module.exports = { apiNotFound };
