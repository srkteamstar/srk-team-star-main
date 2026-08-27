# SRK Team Star

B2B site for an industrial framing machinery and hardware manufacturer —
machines, mouldings, hardware, spare parts. A public marketing and catalogue
site, a storefront with a real cart and checkout,
and an Express/Supabase backend behind all of it.

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
HTML, CSS and browser JS are read off disk per request, so an edit shows up on
the next reload — which trains you to expect that everywhere. Everything under
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

## The one build step, and it is only CSS

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
authored and committed, not generated during deployment; Vercel discovers an
Express project's static files before running an optional build command.

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
| `PAYMENTS_ENABLED` | unset = offline flow. Set = the three Razorpay secrets **must** be present and match `NODE_ENV`, or the process refuses to start. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | |
| `GST_RATE`, `SHIPPING_FLAT`, `SHIPPING_FREE_ABOVE` | placeholders — confirm against the real commercial terms. |

---

## Database

Supabase. `backend/migrations/` holds 27 numbered SQL files, run in order.

Not all of them have been run, and the ones outstanding are outstanding for
reasons rather than by neglect — **020** (a type change on live money columns)
and **023** (destructive, and superseded by 024) are both deliberate. **025**
must be run before checkout works at all; **027** must be run or every enquiry
without a phone number is lost. The migration headers say which is which; read
the one you are about to run.

---

## Verify and test

```bash
npm run verify        # 3 structural checks, ~1s, no network, no database
npm test              # 103 API assertions against the real server.js
npm run test:browser  # 53 Playwright journeys (needs: npx playwright install chromium)
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

**Sign-in for customers takes no password.** An email or a phone number resolves
to a profile and starts a session. Knowing an identifier is owning the account —
so do not gate anything on `isSignedIn()` that a stranger must not reach.
An account that is not a customer is refused at this door outright, and told
only that. The intended fix for customers is a
one-time code, and `resolveIdentifier()` is deliberately separate from
`startSession()` so that step drops between them.

**The browser never talks to Supabase, and that must stay true.** No page loads
a Supabase key or the client SDK. Realtime is off everywhere, because Supabase
filters realtime through RLS and turning it on would mean granting the public
`anon` role `SELECT` on tables full of customer PII. If live updates are ever
wanted, add them server-side — never by granting `anon` a policy.
