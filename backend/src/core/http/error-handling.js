/*
 * core/http/error-handling.js — the last thing between a thrown error and the client
 * ============================================================================
 *
 * S01: server.js used to console.error(error) here — the whole object, not a
 * message. A malformed JSON login request produced an error carrying the
 * complete submitted body, password included, and that landed in platform
 * logs verbatim. This handler never logs the error object, req.body,
 * req.headers or anything database-shaped: only a fixed, server-generated
 * projection safe for log export and incident tooling.
 *
 * F10: the shared app had no final JSON error handler at all, so an
 * unexpected throw fell through to Express's own HTML error page — wrong
 * content type for an API client, and a route to development-mode stack
 * disclosure. This maps the one class of error worth a specific status
 * (a parser refusing the body) to it, and collapses everything else to a
 * flat, safe 500. It is registered once, in the composition root, so both
 * deployment entry points answer identically (S07).
 */
const { randomUUID } = require('node:crypto');

// Only entries a byte-parser can actually raise before any route runs.
// body-parser sets `.type` and `.status`/`.statusCode` on these; nothing here
// trusts that status directly; it maps the type to a fixed pair.
const SAFE_ERROR_TYPES = {
    'entity.parse.failed': { code: 'invalid_json', status: 400, message: 'The request body is not valid JSON.' },
    'entity.too.large': { code: 'body_too_large', status: 413, message: 'The request body is too large.' },
    'encoding.unsupported': { code: 'unsupported_media_type', status: 415, message: 'Unsupported request encoding.' }
};

/**
 * The one final error handler, shared by both entry points.
 *
 * @type {import('express').ErrorRequestHandler}
 */
function finalErrorHandler(error, req, res, next) {
    // Express's own contract: once headers are sent, the only legal move is
    // to hand the error to the default handler, which closes the connection
    // rather than attempting a second response.
    if (res.headersSent) return next(error);

    const requestId = randomUUID();
    const known = SAFE_ERROR_TYPES[error && error.type];
    const status = known ? known.status : 500;
    const code = known ? known.code : 'request_failed';

    // NEVER add error, error.message, error.stack, req.body or req.headers.
    // requestId is what ties this line back to a support conversation without
    // a second copy of whatever the caller sent existing anywhere in a log.
    console.error(JSON.stringify({
        event: 'request_failed',
        requestId,
        code,
        status,
        method: req.method,
        path: req.path
    }));

    res.status(status).json({
        error: known ? known.message : 'Internal server error.',
        requestId
    });
}

module.exports = { finalErrorHandler, SAFE_ERROR_TYPES };
