/*
 * core/config/paths.js — every filesystem root, resolved once
 * ============================================================================
 *
 * `#1` served the entire project directory with a single
 * `express.static(path.join(__dirname, '../'))`, which is why `backend/` sat
 * inside the served tree and needed a deny list to keep `server.js`,
 * `package.json` and the migrations out of the public web. That deny list is
 * still here (core/http/private-paths.js) because defence in depth is cheap,
 * but it is no longer the only thing standing between the source and the
 * internet: the backend is not under a served root at all any more.
 *
 * Nothing else in the codebase may call `path.join(__dirname, '..')` to reach
 * across a tier. A module that needs a directory asks for it here, so moving a
 * folder is one edit rather than a search.
 */
const path = require('path');

/** backend/ — the Node application's own root. */
const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');

/** The repository root, the parent of both tiers. */
const PROJECT_ROOT = path.join(BACKEND_ROOT, '..');

/** frontend/ — everything the browser is ever allowed to see. */
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend');

/** frontend/pages/ — the HTML documents, mounted at `/`. */
const PAGES_ROOT = path.join(FRONTEND_ROOT, 'pages');

/** frontend/js/ — the browser modules, mounted at `/js`. */
const JS_ROOT = path.join(FRONTEND_ROOT, 'js');

/** frontend/assets/ — images, fonts and the compiled stylesheet, at `/assets`. */
const ASSETS_ROOT = path.join(FRONTEND_ROOT, 'assets');

/** frontend/public/ — files that must answer from the site root (robots.txt). */
const PUBLIC_ROOT = path.join(FRONTEND_ROOT, 'public');

/** backend/templates/ — server-rendered shells. Never served as files. */
const TEMPLATES_ROOT = path.join(BACKEND_ROOT, 'templates');

/** The document `/` and `/index.html` both resolve to. */
const INDEX_HTML = path.join(PAGES_ROOT, 'index.html');

/**
 * The legal shell, and the browser module whose policy map the shell route
 * reads at boot rather than writing the titles down a second time.
 */
const LEGAL_SHELL_HTML = path.join(TEMPLATES_ROOT, 'legal-shell.html');
const POLICY_LOADER_JS = path.join(JS_ROOT, 'modules', 'legal', 'policy-loader.js');

module.exports = {
    BACKEND_ROOT,
    PROJECT_ROOT,
    FRONTEND_ROOT,
    PAGES_ROOT,
    JS_ROOT,
    ASSETS_ROOT,
    PUBLIC_ROOT,
    TEMPLATES_ROOT,
    INDEX_HTML,
    LEGAL_SHELL_HTML,
    POLICY_LOADER_JS
};
