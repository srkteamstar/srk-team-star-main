/*
 * server.js — the entry point, and deliberately almost empty
 * ============================================================================
 *
 * `#1`'s server.js was 5,051 lines: every route, every middleware, every
 * commercial constant and every helper in one file. This one loads the
 * environment and starts the application. Everything that used to be here is
 * under src/, arranged by what it is about rather than by what kind of thing
 * it is — see ARCHITECTURE.md for the map and docs/file-inventory.md for where
 * each individual piece went.
 *
 * IT KEEPS THIS NAME AND THIS PATH ON PURPOSE. Three things name it:
 * package.json's `main`, `start` and `dev` scripts; test/authz-harness.js,
 * which boots the REAL server after replacing @supabase/supabase-js, and whose
 * own comment says a copied server.js is a test that silently stops testing;
 * and every note in the project docs. Renaming it would buy nothing and cost
 * all three.
 *
 * dotenv IS LOADED HERE, FIRST, AND ONLY HERE. Everything under src/ reads
 * process.env expecting it to be populated — core/config/commercial.js and
 * core/config/payments.js both compute their values at require time — so the
 * environment has to exist before the first `require('./src/main')` line runs.
 * That is the whole reason this file has two statements in it rather than one.
 *
 * As in `#1`, .env is read once at boot. An edit to a commercial constant, a
 * key or a flag changes NOTHING until the process restarts, with no error and
 * no clue — which reads as "my change did not save" rather than "my server is
 * stale". `npm run dev` (node --watch) is the reflex that goes with editing
 * anything under backend/.
 */
require('dotenv').config();

require('./src/main').start();
