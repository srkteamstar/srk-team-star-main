# Architecture

SRK Team Star, arranged as a **modular monolith**: one process, one deployment,
and boundaries between features that a tool refuses to let you cross by
accident.

This document says *why* the layout is what it is. `docs/file-inventory.md` says
*where every file went*. `README.md` says *how to run it*.

---

## What this is, and what it is not

`#2` is `#1` **rearranged**. Not rewritten, not improved, not modernised.

Every route behaves as it did. Every page URL is the one it was. Every browser
module carries the same globals under the same filenames. `#1`'s own test
suites moved across untouched and pass here. A test suite you had to edit to
make pass is not evidence of anything.

What changed is the shape of the thing:

| | `#1` | `#2` |
|---|---|---|
| Backend | one `server.js`, 5,051 lines | `core/` · `shared/` · eleven feature modules, 71 files |
| Frontend | 44 modules at the site root | `platform/` · `shared/` · one folder per feature |
| Served root | the entire project directory, `backend/` included | `frontend/` only |
| Cross-feature calls | every function in one scope | four edges, each through a published interface |
| Structural checks | none | three, one command, in CI-shaped exit codes |

### One thing left, rather than moved

**This process serves the storefront and nothing else.** The internal
administration console was lifted out into its own repository and its own
deployment: its pages, its browser modules, its controllers, the repositories
only it used, and the second-factor verifier behind its door all went with it.

That is not a tidying. It means the process that answers the public internet no
longer carries a single route that can delete a product, suspend an account or
open a privileged session — not one guarded by a check that has to be got
right, but not present. The two applications exchange everything they need
through the database they share.

What stayed, and looks at first like a leftover, is the rule in
`core/security/guards.js` that an account which is not a customer gets no
storefront session. That is not about the console; it is the storefront's own
rule about who may hold a cart, a delivery address and an order history here.

---

## The two tiers use the same idea

This was the explicit brief, and it is the thing worth noticing about the
layout: **the frontend and the backend are organised on the same principle**, so
knowing where to look in one tells you where to look in the other.

```
backend/src/                        public/js/
├── core/          boot-once         ├── platform/     every page, no domain
│                  infrastructure    │
├── shared/        generic, imports  ├── shared/       used by 2+ features
│                  nothing           │
└── modules/       one bounded       └── modules/      one feature per folder
    ├── auth/      context each          ├── account/
    ├── cart/                            ├── cart/
    ├── checkout/                        ├── checkout/
    ├── orders/                          ├── catalogue/
    ├── payments/                        ├── storefront/
    ├── products/                        ├── quotes/
    ├── quotes/                          ├── enquiries/
    ├── enquiries/                       ├── account/
    └── …                                └── …
```

The names line up where the domains do — `cart`, `checkout`, `quotes` and
`enquiries` exist on both sides and mean the same thing. They diverge
where the tiers genuinely differ: the browser has `storefront` (the store shell
and its six section loaders) and `product-details`, which are surfaces rather
than tables; the server has `customers` and `projects`, which are tables rather
than surfaces.

---

## `backend/src/core/` — initialised once, knows no business

```
core/
├── config/
│   ├── app-settings.js     trust proxy, x-powered-by
│   ├── commercial.js       GST, delivery, the two order ceilings
│   ├── payments.js         PAYMENTS_ENABLED + the boot assertion
│   ├── paths.js            every filesystem root, resolved once
│   └── static-mounts.js    the URL → folder table
├── database/
│   ├── supabase.js         the one client, service-role key
│   └── postgrest-errors.js what a Supabase failure MEANS
├── gateways/
│   └── razorpay.js         the external-system adapter
├── health/
│   └── probes.js           /health/live, /health/ready
├── http/
│   ├── cors.js  csrf.js  security-headers.js  body-parsing.js
│   ├── session.js  private-paths.js  static-files.js  not-found.js
├── security/
│   └── guards.js           requireCustomer and the role resolvers
└── uploads/
    └── image-upload.js     multer, one file-type filter
```

Nothing in `core/` names a table, a customer or an order. It is what every
module stands on, and it may never import one — `tools/verify-boundaries.js`
fails the build if it does, because the day it does, the dependency graph has a
cycle and boot order starts to matter.

**`core/config/paths.js` is the only place a `path.join(__dirname, '..')`
crosses a tier.** In `#1`, `server.js` reached out to the project root in four
separate places and `express.static` served all of it. Here, a module that needs
a directory asks for it by name, so moving a folder is one edit rather than a
search.

**`core/config/static-mounts.js` is read twice and written once.** The server
mounts from it; `tools/verify-links.js` resolves every `href` and `src` in the
project against it. A verifier with its own copy of the routing table is a
verifier that passes while the site is broken.

---

## `backend/src/shared/` — generic, and a leaf in the graph

```
shared/
├── validation.js           the bounds every anonymous write is held to
├── money.js                reading a text price, keeping a total honest
├── text.js                 escapeHtmlText, slugify, cut
└── contracts/
    ├── order-status.js     the fulfilment vocabulary
    ├── order-reference.js  ORD-<year>-<number>
    └── payment.js          statuses, currency, the offline instruments
```

**`shared/` imports nothing from this project.** Not a module, not even `core/`.
That is enforced. The rule the doctrine gives is the right one: *a shared
utility that needs to know about the users module is not shared — it is a
domain service masquerading as a utility.*

**`shared/contracts/` is the part that needed a decision.** `ORDER_STATUSES` and
`PAYMENT_STATUS` are domain vocabulary, and the instinct is to put domain
vocabulary in the module that owns the domain. But three modules must agree on
these strings and **none of them owns all three transitions**: `checkout` writes
the initial status, `payments` clears `Pending Payment` when money lands, and
`orders` is the only one that exposes the whole list to an administrator. Park
the list in any one of them and the other two import a sibling to read a
constant — and `orders → payments → orders` is exactly the import cycle the
doctrine's barrel-file section warns about. So they sit where nothing owns them
and everything may read them.

---

## `backend/src/modules/` — eleven bounded contexts

| Module | Owns | Routes |
|---|---|---|
| `auth` | the account and the storefront's one sign-in door | 5 |
| `enquiries` | `enquiries`, `form_types` | 1 |
| `quotes` | `quote_requests` + items | 1 |
| `projects` | `upcoming_projects` as the site reads them | 1 |
| `categories` | `categories`, the image bucket | 1 |
| `products` | `products`, `product_images` | 1 |
| `orders` | orders as a **record** | 2 |
| `cart` | `cart_items` | 2 |
| `checkout` | turning a basket into an order | 2 |
| `payments` | `payments`, `payment_events`, Razorpay | 2 |
| `legal` | six URLs from one template | 1 (regex) |

Each module is:

```
<module>/
├── <module>.module.js       the registration file — builds and returns a Router
├── <module>.public.js       the ONLY file a sibling may require (where needed)
├── controllers/             transport: route, validate, delegate, respond
├── services/                orchestration and the rules that span rows
├── domain/                  vocabularies and pure functions
└── infrastructure/          the queries, and the rate limiters
```

**Where a module has no natural service layer, it has no services folder.** An
empty `services/` holding a one-line pass-through is indirection pretending to
be architecture. `enquiries` has one because the no-JS redirect genuinely is a
service; `customers` has one because both of its writes share a refusal;
`categories` has none, because its controllers are queries with a shape.

**The route handlers were NOT thinned.** The doctrine is right that a controller
should parse, validate and delegate — and thinning 46 handlers by hand is 46
opportunities to change behaviour in a pass whose entire premise is that
behaviour does not change. The handlers moved whole. Extracting them is the next
pass, and it should be done one module at a time with the suites green after
each. This is stated here rather than left for a reader to discover and assume
was an oversight.

---

## The four cross-module edges

`tools/verify-boundaries.js` prints them on every run, which is the point — the
whole claim of this architecture is that they are countable:

```
categories -> products     countProductsByCategory
checkout   -> products     findActiveProductsByIds
checkout   -> auth         the guest-checkout account and its session
orders     -> payments     gatewayPaymentRow
```

Three of the four are **read ports**: narrow, query-shaped, side-effect free.
That is the doctrine's rule for a synchronous cross-module call — reads may
cross a boundary through an explicit interface; writes may not cross at all.

The fourth, `checkout → auth`, includes `startSession`, which is a **write**.
See the deviations below.

There is **no cycle**. `payments` never imports `orders`, which is why the
status vocabulary is in `shared/contracts/`.

---

## Deviations from the doctrine, and why

The brief was: retain every function and every element of the UI. Where the
doctrine and that brief disagreed, the brief won, and the disagreement is
written down here rather than quietly resolved.

**1. No event bus, no transactional outbox.** The doctrine says state-changing
cross-module work should be a domain event. Converting a synchronous call into
an asynchronous one is a behaviour change by definition, and two of the three
candidates cannot take it:

- `startSession` during guest checkout — the customer has to be signed in by the
  time the checkout response is written.
- `markOrderPaid` writing the `orders` table — the four gateway checks and the
  status flip have to be one indivisible decision. Splitting the write into an
  event `orders` consumed would put a gap between "we proved money moved" and
  "the order says so", in the one place in this system where that gap is
  expensive. The final `UPDATE` is guarded on the awaiting-payment status **in
  the WHERE clause**, which is what makes it safe to run twice.

An unused event bus is not architecture, it is dead code — and this repository
already has a note about an unused write grant being an unguarded door. So there
is none.

**2. Repositories are not behind interfaces.** They are concrete functions over
the Supabase client. In a language with static types the interface earns its
keep; in CommonJS, `IProductRepository` is a comment with extra steps. The
substitutability the doctrine wants is already there and already used: the test
harness swaps `@supabase/supabase-js` at require time, which is why the API
assertions run against the real `server.js` without touching the live project.

**3. One database schema, not one per module.** The doctrine prefers a schema
per module. This database is Supabase, its RLS posture is deliberate and
documented per table, migration 025 puts the whole order write inside one
Postgres function, and re-namespacing 20-odd tables is a data migration on live
financial records. That is not a folder move. It is left as a documented future
step, and the module boundaries in code are what would make it possible.

**4. Controllers were not thinned.** As above.

**5. One behaviour difference, and it is deliberate.** In `#1`,
`htmlPagesContaining()` scanned the project root and skipped `backend/` — so the
legal shell, which lives under `backend/templates/`, was never scanned. The
shell **carries a `data-map-embed` placeholder**, so all six policy pages showed
a map the CSP would refuse to load if anybody clicked it. `#2` scans the shell
too, and grants those six URLs the same `frame-src` the four other map-bearing
pages already had.

This makes a visible, dead UI element work. It widens the CSP on six documents
to the two Google hosts already granted elsewhere, derived by the same
read-don't-write rule rather than a hand-written list. **If you would rather
match `#1` exactly, delete the `ROUTED_URLS.filter(...)` block in
`core/http/security-headers.js`** — it is eight lines and nothing else depends
on it.

---

## `frontend/` — the same idea, one tier out

```
frontend/
└── pages/          the HTML. Mounted at `/`, so URLs are unchanged.
    ├── index.html  about.html  catalogue.html  contact.html
    ├── store/      store.html  checkout.html
    └── blog/       index.html + 8 articles

public/             committed here so Vercel can discover static assets
├── assets/         images, fonts, the compiled stylesheet
├── robots.txt      file that must answer from the site root
└── js/
    ├── platform/   8 modules on every page, no domain knowledge
    ├── shared/     2 modules used by more than one feature
    ├── modules/    24 modules, one folder per feature
    └── legacy/     2 modules no page loads — carried, not wired
```

**No page URL changed.** `/index.html`, `/catalogue.html`, `/store/store.html`,
`/blog/<slug>/`, `/legal/<policy>.html`, `/assets/**`, `/robots.txt` all answer
exactly what they answered before. They are the contract — every footer links
them, bookmarks hold them, crawlers have them.

**Module URLs did change**, from `/<file>.js` to `/js/<layer>/<file>.js`, and
every one of the documents was rewritten from a map generated off the real
file tree rather than by hand. `tools/verify-links.js` re-checks all 691
site-absolute references on demand.

**The `window.*` global convention stays.** ES modules would break every
inline `onclick` and every cross-module call at once. Those globals are the modules' public interface and are
documented as such; converting them is a separate task with its own risk.

**Script load ORDER inside each page is unchanged**, and it is load-bearing —
`product-section-shared-module.js` before the section loaders,
`customer-session-module.js` before `cart-module.js`,
`view-state-restore-module.js` last on every page.

---

## Serving: four mounts, and a backend that is not under any of them

```
/js       → public/js
/assets   → public/assets
/         → public               (robots.txt)
/         → frontend/pages       (the documents, including store/ and blog/)
```

In `#1`, `express.static` served the whole project directory and `backend/` sat
inside it, so `/backend/server.js`, `/backend/package.json` and every migration
were readable by anyone who asked. A `PRIVATE_PATH` regex was the only thing
refusing them.

That regex is still here, and it is **no longer load-bearing**: the mounts serve
only `public/` and `frontend/pages/`, so there is no path a request can spell that
reaches the backend at any depth. That is a stronger guarantee than a deny list,
because it cannot be defeated by a pattern nobody thought of. The guard stays
anyway — it costs one regex per request, it still refuses stray `.md`/`.sql`/
`.log` files that end up under `frontend/`, and it carries the `X-Robots-Tag`
rule, which was never about privacy.

---

## The middleware order is behaviour

`main.js` states it once, in a readable list. Three parts of it are
load-bearing:

- **`trust proxy` first**, before anything reads `req.ip`. Every rate limiter in
  every module keys on it.
- **The body parsers before the session and before any route.** The JSON
  parser's `verify` hook captures the raw bytes Razorpay signs, and that hook is
  the webhook's entire security model. It cannot be added later in the chain.
- **The legal route before the static mounts.** It answers six URLs with no file
  behind them; the static handler would 404 them first.

Modules are registered in the order their routes were declared in `#1`. No two
claim the same path, so it is not load-bearing today — it is kept identical so
that a behaviour difference, if one is ever found, cannot be blamed on
registration order.

---

## Verification

```
npm run verify           three structural checks, ~1s, no network, no database
npm test                 103 API assertions against the real server.js
npm run test:browser     53 Playwright journeys
npm run test:all         all of it
```

`npm run verify` is the one to run after moving or renaming **any** file:

- **verify-links** — every `href`/`src` in every page and every browser module
  resolves through the same mount table the server uses.
- **verify-boundaries** — no module reaches past a sibling's `.public.js`,
  `shared/` imports nothing, `core/` imports no module, no barrel files.
- **verify-boot** — every file under `backend/src/` loads, and the assembled
  route table matches `tools/api-surface.json` **both ways**. A missing route
  fails; so does an unexpected one.

That last check is what makes "retain every function" a build rule rather than
a promise. `api-surface.json` was extracted mechanically from `#1`'s
`server.js`, not typed out from the documentation, and the routes that went to
the administration console were removed from it in the same commit that removed
them from the application — so the contract still fails a route that appears
without being declared, in either direction.
