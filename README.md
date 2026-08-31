# SRK Team Star

B2B site for an industrial framing machinery and hardware manufacturer —
machines, mouldings, hardware, spare parts. A public marketing and catalogue
site, a storefront with a real cart and checkout,
and an Express/Supabase backend behind all of it.

The customer-facing quotation flow, server calculation contract, print
boundary and deployment steps are documented in
[`docs/quotation-system.md`](docs/quotation-system.md).

The post-order purchase invoice contract, ownership rules, frozen snapshots
and A4 print behaviour are documented in
[`docs/order-invoice-system.md`](docs/order-invoice-system.md).

This is `#2`: the same application as `#1`, arranged as a modular monolith. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the layout and the reasoning, and
[`docs/file-inventory.md`](docs/file-inventory.md) for where any given `#1` file
went.

---

## Run it

```bash
cd backend
npm install
cp .env.example .env      # then fill it in — see below
npm start
```

One process serves the API **and** the whole frontend. Open
`http://localhost:3000`.

While editing the backend, use **`npm run dev`** (`node --watch server.js`)
instead. This is not a convenience, it is the fix for a trap the layout creates:
HTML is read off disk per request. CSS and browser JS now use generated,
content-hashed URLs: run `npm run build:assets` from the repository root after
editing their sources, then reload. Everything under
`backend/src/` is loaded into memory once at boot. An edit to a commercial
constant, a route or a validation rule changes **nothing** until the process
restarts, with no error and no clue. `.env` is read at boot too.

To settle "did my edit take effect", ask the running process:

```bash
curl -s -X POST http://localhost:3000/api/checkout/summary \
  -H "Content-Type: application/json" -d '{"items":[{"product_id":9,"quantity":1}]}'
```

It answers with the commercial constants the **running** process is using.

---

## CSS and web asset builds

```bash
npm run build:css     # compile once
npm run watch:css     # rebuild on save — the reflex that goes with npm run dev
```

Tailwind is compiled ahead of time into
`public/assets/vendor/tailwind.build.css`. **A new class does not exist until
the sheet is rebuilt.** The generated file is committed, so a fresh checkout
runs with no build; only whoever changed a class needs to run it.

`backend/tailwind.config.js` scans `frontend/pages/**/*.html`,
`backend/templates/*.html` and `public/js/**/*.js`. That last glob is
load-bearing — most markup in this project is built in JavaScript string
literals, and a content list of HTML alone would produce a stylesheet that looks
complete and silently drops the entire store UI. Tailwind matches literal text,
so **write class names out in full**; a name assembled from pieces
(`'bg-' + colour`) will not survive the build.

The root `public/` tree is also the source Vercel serves through its CDN. It is
committed, not generated during deployment; Vercel discovers an
Express project's static files before running an optional build command.

`npm run build:css` also refreshes the versioned asset URLs. After other browser
JS/CSS edits (including changes produced by `watch:css`), run `npm run build:assets`
from the root. Keep editing the original files in `public/js/` and
`public/assets/styles/`, not their generated copies in `public/assets/versioned/`.
The `data-asset-source` attributes in HTML record those original paths.

`npm run build` verifies that generated files, image hashes and all HTML references
are current before deployment. Commit the generated files and manifests along
with source changes. Hash-named assets receive immutable caching; HTML, stable
source URLs and private API responses do not acquire that policy.

Only the allowlisted local PNGs in `tools/optimize-local-images.js` are converted;
Supabase images and existing AVIFs are untouched. Original images stay in place.
To regenerate image variants, supply Sharp through `SRK_SHARP_MODULE` (an absolute
path to an installed Sharp module), run `npm run build:images`, then
`npm run build:assets`. Normal builds need no image-conversion dependency.

---

## Environment

`backend/.env`, never committed. `backend/.env.example` is the template.

| Variable | |
|---|---|
| `PORT` | default 3000 |
| `SESSION_SECRET` | **required**, ≥32 characters. The process refuses to start without it. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the service-role key, which bypasses RLS. It never reaches a browser. |
| `TRUST_PROXY` | unset unless something really is proxying this process. Wrong in one direction costs a shared rate-limit bucket; wrong in the other removes rate limiting entirely. |
| `ALLOWED_ORIGINS` | empty unless the frontend is served from elsewhere. |
| `OPERATIONAL_ALERT_WEBHOOK_URL` | optional HTTPS receiver for redacted payment/reconciliation alerts; events are always written as structured platform logs. |
| `PAYMENTS_ENABLED` | unset = offline flow. Set = the three Razorpay secrets **must** be present and match `NODE_ENV`, or the process refuses to start. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | |
| `GST_RATE`, `SHIPPING_FREE_ABOVE` | Confirmed defaults: 18% GST and free delivery from ₹50,000. Lower-value delivery is collected at delivery and excluded from the website total. |

---

## Database

Supabase. `backend/migrations/` holds numbered SQL files, run in order.

The configured production schema was checked on 29 August 2026: **020, 025,
027, 028 and 029–031 are present**. New deployments must also apply **032**
(shared sessions and rate-limit state) and **033** (atomic payment settlement)
before deploying the matching application code. Migration 023 remains
superseded by 024 and must not be run.

---

## Verify and test

```bash
npm run verify        # 3 structural checks, ~1s, no network, no database
npm test              # 130 API assertions against the real server.js
npm run test:browser  # 62 Playwright journeys (needs: npx playwright install chromium)
npm run test:all      # all of it
```

**Run `npm run verify` after moving or renaming any file**, front or back. It is
the check that catches the failure this structure makes possible: a reference
that points at nothing, a module reaching past a sibling's published interface,
or a route that quietly stopped existing.

```
verify-links       every href/src resolves through the real mount table
verify-boundaries  the four import rules, enforced
verify-boot        every file loads; the route table matches the contract
```

The API and browser suites boot the **real** `backend/server.js` with only
`@supabase/supabase-js` and `fetch` replaced by in-memory stubs. They touch no
live data.

---

## Operator scripts

All read-only or dry-run by default, all invoked by hand rather than on a timer.

```bash
npm run reconcile                    # diff Razorpay's payments against ours
npm run reconcile:scheduled          # the same, logged and locked
npm run reconcile:schedule-install   # preview the Windows scheduled task
node scripts/expire-unpaid-orders.js         # dry run
node scripts/expire-unpaid-orders.js --apply
node scripts/inspect-order.js <id>
node scripts/check-webhook.js
```

`reconcile.js` is the only check here that can find what is **missing** — a
payment captured at the gateway that this database has no record of. It found a
real one on its first run. It is read-only on purpose: a reconciliation tool
that "fixes" rows is one that can quietly mark things paid.

---

## Layout

```
backend/
  server.js              two statements: load .env, start the app
  src/
    main.js              the composition root
    core/                boot-once infrastructure, no business logic
    shared/              generic; imports nothing from this project
    modules/             eleven bounded contexts
  migrations/  scripts/  templates/  styles/  test/
frontend/
  pages/                 the HTML, mounted at /
  assets/                images, fonts, the compiled stylesheet
  public/                robots.txt
  js/
    platform/            on every page, no domain knowledge
    shared/              used by more than one feature
    modules/             one folder per feature
    legacy/              carried, not wired
tools/                   verify-links · verify-boundaries · verify-boot
docs/                    file-inventory.md
```

---

## Two things to know before changing anything

**Customer sign-in requires an email-or-phone identifier and a password.** The
server stores only salted scrypt hashes, verifies the password before opening a
session, and never returns the hash. Checkout is a true guest flow: it captures
contact details on the order, creates no account, and opens no session.
Run migration 028 before deploying this code. Profiles created during the old
identifier-only period have no trustworthy password to backfill and remain
locked until their credential is reset.

**The browser never talks to Supabase, and that must stay true.** No page loads
a Supabase key or the client SDK. Realtime is off everywhere, because Supabase
filters realtime through RLS and turning it on would mean granting the public
`anon` role `SELECT` on tables full of customer PII. If live updates are ever
wanted, add them server-side — never by granting `anon` a policy.
