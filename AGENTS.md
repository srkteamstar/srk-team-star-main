# AGENTS.md — the working guide for `#2`

Read this first, then [`ARCHITECTURE.md`](ARCHITECTURE.md) for the layout and
its reasoning, [`README.md`](README.md) for how to run it, and
[`docs/file-inventory.md`](docs/file-inventory.md) to find where any `#1` file
went.

**`#1` is still on disk and is still the historical record.** Its `AGENTS.md`
and `CLAUDE.md` (349KB between them) hold the full account of *why* this
application behaves as it does — every bug that was found, every trade that was
weighed. Nothing in that account has been deleted; what is repeated below is the
part you need in your hands while editing `#2`, with the paths corrected. When
you want the story behind a behaviour, `#1`'s notes are where it is.

---

## The first thing to know

**`#2` is `#1` rearranged, not rewritten.** Every route behaves as it did, every
page URL is unchanged, every browser global keeps its name. `#1`'s own suites
moved across untouched and pass here.

So: **if you find yourself about to change behaviour, that is a separate change
from anything structural, and it should be its own commit with its own
reasoning.** The value of this codebase is that the two are not mixed.

**This process serves the storefront and nothing else.** The internal
administration console is a separate repository on a separate deployment. It
holds its own copy of `core/` and `shared/`, its own door, and every route that
can delete a product or suspend an account. The two applications exchange
everything they need through the Supabase project they share — there is no
shared session, no shared cookie and no API call in either direction.

**Do not bring any of it back.** `tools/verify-boot.js` compares the assembled
route table against `tools/api-surface.json` in both directions, so a
privileged route added here fails the build before it reaches a deployment.
That check is the rule; this paragraph is only the reason for it.

---

## Run, verify, test

```bash
cd backend
npm install && npm start          # or: npm run dev  (node --watch)
npm run verify                    # 3 structural checks, ~1s
npm test                          # 103 API assertions
npm run test:browser              # 53 Playwright journeys
npm run test:all                  # verify + both suites
npm run build:css                 # Tailwind, ahead of time
npm run watch:css                 # the reflex that goes with npm run dev
```

**Run `npm run verify` after moving or renaming ANY file, front or back.** It is
the check that catches what this structure makes possible:

| | catches |
|---|---|
| `verify-links` | an `href`/`src` that points at nothing, resolved through the **real** mount table |
| `verify-boundaries` | a module reaching past a sibling's `.public.js`; `shared/` importing something; `core/` importing a module; a barrel file |
| `verify-boot` | a file that no longer loads; a route that vanished **or appeared** |

---

## Where things are

```
backend/src/                      public/js/
  main.js      composition root     platform/   every page, no domain
  core/        boot-once infra      shared/     used by 2+ features
  shared/      generic, no imports  modules/    one folder per feature
  modules/     11 bounded contexts  legacy/     carried, not wired
```

Both tiers use the same idea and the same names where the domains match —
`cart`, `checkout`, `quotes` and `enquiries` exist on both sides.

**Rules a tool enforces, so do not work around them:**

1. `shared/` imports **nothing** from this project. A utility that needs a
   module is a domain service in the wrong folder.
2. `core/` never imports a module.
3. A module reaches a sibling **only** through `modules/<name>/<name>.public.js`.
   There are exactly four such edges today and `verify-boundaries` prints them.
4. No barrel files. A `.public.js` is not a barrel — it is a hand-written,
   deliberately narrow interface.

---

## Traps that will cost you an afternoon

**Backend edits need a restart.** HTML, CSS and browser JS are read off disk per
request; everything under `backend/src/` is loaded into memory once at boot. An
edit to a commercial constant, a route or a validation rule changes **nothing**
until the process restarts, with no error and no clue. It reads as "my change
did not save". Use `npm run dev`. `POST /api/checkout/summary` reports the
constants the **running** process is using.

**A new Tailwind class does not exist until `npm run build:css`.** There is
exactly one build step and this is it. The content globs include
`public/js/**/*.js` because most markup here is built in JS string literals —
and Tailwind matches literal text, so **write class names out in full**. A class
assembled from pieces (`'bg-' + colour`) will not survive.

**`* { color: … }` breaks `currentColor` icons.** Every page's inline `<style>`
opens with a universal rule that sets `color` on every element, `<svg>`
included. A direct match beats an inherited value, so an icon drawn with
`stroke="currentColor"` can never pick up a colour its parent hands down —
`hover:text-white` on a button leaves its icon unchanged. The fix is a CSS rule
that paints the icon itself, not a Tailwind class on the parent. `.store-icon`
strokes gold (buttons that stay white); `.cart-icon-btn` strokes white (buttons
that fill dark). Picking the wrong one gives you white-on-white.

**Script load order inside a page is load-bearing.** There is no module system
on the frontend — everything communicates through `window` globals. In
particular: `product-section-shared-module.js` **before** the section loaders;
`store-overlay-shared-module.js` after it; `customer-session-module.js`
**before** `cart-module.js` (which reads it as it evaluates, to learn whose cart
it is holding); `view-state-restore-module.js` **last on every page**, because
it replays clicks into handlers that must already exist.

**Anything served from a route rather than a static mount sets its own headers.**
`.js`/`.css`/`.html` get `Cache-Control: no-cache` from the mounts. The legal
shell route sets it by hand for exactly this reason.

---

## The security posture — do not loosen any of this by accident

**The browser never talks to Supabase.** No page loads a key or the SDK. This
was not true once: `enquiries.js` shipped the anon key in plain text and
subscribed over Realtime, and a `curl` with that key returned every enquiry ever
submitted — names, emails, phones, messages. Supabase filters Realtime through
RLS, so live updates from the browser *require* granting `anon` a SELECT policy,
and the anon key is public by definition. **If you ever want live updates, add
them server-side. Never by granting `anon` a policy.**

**Sign-in for customers takes no password.** An email or phone resolves to a
profile and starts a session. Knowing an identifier is owning the account. Do
not gate anything on `isSignedIn()` that a stranger must not reach. The intended
fix is a one-time code, and `resolveIdentifier()` in
`modules/auth/services/session.service.js` is deliberately separate from
`startSession()` so that step drops between them without changing the route, the
browser module or the overlay.

**Only a customer gets a session here, and the refusal says nothing.**
`POST /api/auth/login` answers a non-customer profile with a flat 403 and one
sentence. It used to name the role in a flag the account overlay branched on,
which turned a route anybody may call into a way to ask "is this address
privileged?" of any address somebody had already guessed. Nothing on this site
needs that question answered, so it is not; `authLimiter` remains what keeps
the identifier check itself from being an enumeration oracle.

**Nothing can raise a role** — signup hard-codes customer, `PATCH /api/auth/me`
refuses `role_id`, `POST /api/checkout` refuses to adopt or create a
non-customer profile. Changing a role is a hand edit in the Supabase table
editor.

**`GET /api/auth/me` answers `{ customer: null }` for any session this
application did not open.** That one line is what keeps a non-customer off the
storefront, and it deleted a whole class of special case rather than adding one
more. `req.session.scope` records which door a session came through, and a
customer scope is the only one this process writes — `guards.js` still checks
it rather than assuming, because a session reaching here from anywhere else
must not be trusted on the strength of that.

**A callback from the client is not proof that money moved.** `markOrderPaid()`
is the only code that may write `payments.status = 'Paid'`, it is called by both
the callback and the webhook, and it believes neither: it asks Razorpay directly
every time and checks four things — captured, exact paise, correct currency, and
**the gateway order id matches the one stored on this row**. That fourth check
is the one most integrations miss; without it a genuine signature from a ₹1
payment can be replayed against a ₹5,00,000 order. **Do not add a "mark as paid"
path a browser can reach.**

**Rate limiters are per route, never shared.** One `express-rate-limit` instance
is one counter per IP, so a shared instance makes two routes share a budget.
Each module declares its own in `infrastructure/*-rate-limit.js`. The one
deliberate exception is `authLimiter`, shared by both sign-in doors — there, a
separate budget would only hand an attacker twice as many attempts.

**The webhook is deliberately not rate limited.** Razorpay retries until it gets
a 2xx; a 429 is not a 2xx, so a limiter there turns a burst of legitimate
deliveries into orders that were paid for and never marked.

**`trust proxy` is opt-in.** Unconditional, it makes `X-Forwarded-For`
client-controlled, and every limiter keys on `req.ip` — one header per request
gives each attempt a fresh bucket. Set `TRUST_PROXY` only if a proxy really is
in front.

---

## Commercial rules

`core/config/commercial.js`: GST 18%, delivery ₹1,500, free above ₹50,000.
**These are placeholders and should be confirmed.** GST is charged on delivery
as well as goods — freight bundled with the goods it carries is a composite
supply and takes the rate of the principal supply.

**The browser never names a price.** It sends product ids and quantities;
`priceCheckout()` prices the basket from the `products` table. Summary and
checkout run the *same* function, so what is displayed and what is charged
cannot drift — and they run twice on purpose, because minutes can pass between
them and the order is written at the price that is real when it is written.

**A product priced "On request" cannot be checked out** — 43 of 48 rows today,
so it is the common path. The line is shown struck through with the reason and
the whole order is refused rather than quietly dropped from a total the customer
is looking at. The quote overlay is the route for those.

---

## Migrations

27 files in `backend/migrations/`, run in order. Three are worth knowing:

- **025** puts the whole order write (header, items, frozen address, payment
  row) inside one Postgres function. **Must be run before checkout works at all.**
- **027** converts `enquiries.enquirer_phone_number` from `int8` to `text` and
  drops its NOT NULL. **Until it is run, every enquiry from anyone who did not
  give a phone number is lost** with a 23502. The route carries a single
  documented retry for the pre-027 window — **delete that retry once 027 is
  everywhere.**
- **020** converts four money columns to `numeric(12,2)`. Written, not run.
  Take a backup first — it is a type change on live financial records.

Migrations do DDL only. A migration that manipulates live data is how a
deployment turns into an outage.

---

## Known issues, carried over unchanged from `#1`

- The header nav's **`/blog`** and **`/about`** links 404 on the public pages.
  Left as-is **by explicit request** — building the pages is the fix; removing
  the links is not.
- The store's **"Bought Together → View All"** is still `href="#"`. Its only
  plausible destination is the Complete Sets nav button, and no section is
  registered against `data-policy="combos"`.
- The store home view's **four demo product cards** and four "Add Bundle"
  buttons are inert: no `data-product-id`, so the delegated cart listener cannot
  match them. **If you make them live, give them real product ids** — do not
  hide or regenerate the row. The home view is hand-designed and is the owner's.
- `public/js/legacy/` holds two modules no page loads.
- **Product details is mouse-only.** An `<article>` is not focusable, so a
  keyboard visitor can reach Buy Now and the bag icon but not the details route.
  The fix is `tabindex="0" role="button"` plus an Enter/Space handler in
  `public/js/shared/product-section-shared-module.js` — small, but it adds a
  tab stop to a render path five surfaces share, so it belongs in its own change.

## Still open before live keys

- **Sign-in still takes no password.** That is the real gate.
- Migration **020** written, not run.
- The reconciliation schedule is **not installed** on any machine
  (`scripts/schedule-reconcile.ps1 -Apply`). The script existing is not the same
  as it running.
- `GST_RATE`, `SHIPPING_FLAT`, `SHIPPING_FREE_ABOVE` are placeholders.
- Migration **027** has not been run.

---

## Next structural steps, in the order they are worth doing

Each is a separate pass, and each should end with all three suites green.

1. **Thin the controllers, one module at a time.** They moved whole, so the
   route handlers still hold their own orchestration. Extract to `services/`
   per module, not all at once.
2. **Extract the inline handlers** — twelve `onclick=` attributes and eleven
   inline `<script>` blocks. That is what stands between the CSP and dropping
   `'unsafe-inline'` from `script-src`.
3. **Per-module database schemas.** The module boundaries in code are what make
   this possible; it is a data migration, not a folder move.
4. **ES modules on the frontend.** Blocked by every inline `onclick` and every
   cross-module `window.*` call at once.
