# File inventory — every `#1` file, and where it is in `#2`


`#2` is `#1` rearranged, not rewritten. This file is the map, and it exists so
that "where did X go?" is a lookup rather than a search. It is the companion to
`ARCHITECTURE.md`, which says *why* the layout is what it is.

**The rule the move followed: code was RELOCATED, not retyped.** Every route
handler, every helper and every comment in `backend/src/` was lifted out of
`#1/backend/server.js` by line range and pasted, unedited, into the file that
now owns it. Where a lifted region needed a change, that change is listed
explicitly at the bottom of this document — there are eight of them, and no
others.

---

## Frontend browser modules

All 44 files kept their **filenames**. Only their folders changed, and with them
their URLs: `/<file>.js` became `/js/<layer>/<file>.js`. Filenames were left
alone deliberately — they are named throughout `#1`'s working notes, in code
comments across the codebase, and in the test suites, and renaming them would
have made every one of those references a small lie for no gain.


| `#1` (served at `/<name>`) | `#2` | Layer |
|---|---|---|
| `admin-auth-module.js` | **moved to the administration console** *(separate repository)* | — |
| `all-products-section-loader-module.js` | `public/js/modules/storefront/sections/all-products-section-loader-module.js` | `modules/storefront` |
| `best-seller-section-loader.js` | `public/js/modules/storefront/sections/best-seller-section-loader.js` | `modules/storefront` |
| `blog-filter-module.js` | `public/js/modules/blog/blog-filter-module.js` | `modules/blog` |
| `cart-module.js` | `public/js/modules/cart/cart-module.js` | `modules/cart` |
| `categories.js` | **moved to the administration console** *(separate repository)* | — |
| `checkout-module.js` | `public/js/modules/checkout/checkout-module.js` | `modules/checkout` |
| `crousel-and-data-module.js` | `public/js/legacy/crousel-and-data-module.js` | `legacy` |
| `custom-select-module.js` | `public/js/platform/custom-select-module.js` | `platform` |
| `customer-session-module.js` | `public/js/modules/account/customer-session-module.js` | `modules/account` |
| `customers.js` | **moved to the administration console** *(separate repository)* | — |
| `dashboard.js` | **moved to the administration console** *(separate repository)* | — |
| `disable-input-suggestions-module.js` | `public/js/platform/disable-input-suggestions-module.js` | `platform` |
| `enquiries.js` | **moved to the administration console** *(separate repository)* | — |
| `enquiry-form-module.js` | `public/js/modules/enquiries/enquiry-form-module.js` | `modules/enquiries` |
| `featured-categories-loader.js` | `public/js/modules/storefront/sections/featured-categories-loader.js` | `modules/storefront` |
| `featured-hero-loader.js` | `public/js/modules/storefront/sections/featured-hero-loader.js` | `modules/storefront` |
| `featured-section-loader.js` | `public/js/modules/storefront/sections/featured-section-loader.js` | `modules/storefront` |
| `general-scroll-reveal-module.js` | `public/js/platform/general-scroll-reveal-module.js` | `platform` |
| `hero-text-animation-module.js` | `public/js/legacy/hero-text-animation-module.js` | `legacy` |
| `image-slider-module.js` | `public/js/modules/marketing/image-slider-module.js` | `modules/marketing` |
| `legal-progress-bar-nav-col.js` | `public/js/modules/legal/legal-progress-bar-nav-col.js` | `modules/legal` |
| `map-consent-module.js` | `public/js/platform/map-consent-module.js` | `platform` |
| `my-orders-module.js` | `public/js/modules/account/my-orders-module.js` | `modules/account` |
| `new-arrivals-section-loader.js` | `public/js/modules/storefront/sections/new-arrivals-section-loader.js` | `modules/storefront` |
| `orders.js` | **moved to the administration console** *(separate repository)* | — |
| `payment-module.js` | `public/js/modules/checkout/payment-module.js` | `modules/checkout` |
| `policy-loader.js` | `public/js/modules/legal/policy-loader.js` | `modules/legal` |
| `price-format-module.js` | `public/js/shared/price-format-module.js` | `shared` |
| `product-card-and-filter-tab-module.js` | `public/js/modules/catalogue/product-card-and-filter-tab-module.js` | `modules/catalogue` |
| `product-details-module.js` | `public/js/modules/product-details/product-details-module.js` | `modules/product-details` |
| `product-section-shared-module.js` | `public/js/shared/product-section-shared-module.js` | `shared` |
| `products.js` | **moved to the administration console** *(separate repository)* | — |
| `profile-icon-loader.js` | `public/js/modules/account/profile-icon-loader.js` | `modules/account` |
| `quotations.js` | **moved to the administration console** *(separate repository)* | — |
| `request-quote-module.js` | `public/js/modules/quotes/request-quote-module.js` | `modules/quotes` |
| `responsive-navigation-module.js` | `public/js/platform/responsive-navigation-module.js` | `platform` |
| `smooth-scroll-and-header-controllability-module.js` | `public/js/platform/smooth-scroll-and-header-controllability-module.js` | `platform` |
| `stats-control-module.js` | `public/js/modules/marketing/stats-control-module.js` | `modules/marketing` |
| `store-overlay-shared-module.js` | `public/js/modules/storefront/shared/store-overlay-shared-module.js` | `modules/storefront` |
| `store-route-context-module.js` | `public/js/modules/storefront/shared/store-route-context-module.js` | `modules/storefront` |
| `store-search-module.js` | `public/js/modules/search/store-search-module.js` | `modules/search` |
| `upcoming-projects.js` | **moved to the administration console** *(separate repository)* | — |
| `view-state-restore-module.js` | `public/js/platform/view-state-restore-module.js` | `platform` |

**`platform/`** is loaded on every page and knows nothing about the domain —
input hardening, the phone navigation, scroll behaviour, the custom select, the
map consent gate, view-state restoration. **`shared/`** is what more than one
feature surface needs: the product card and section machinery (the catalogue
page and four store sections), and price formatting (the store and the admin
dashboard). **`legacy/`** holds the two files no page loads in `#1` either —
`crousel-and-data-module.js` and `hero-text-animation-module.js`. They are
carried rather than deleted, and carried rather than wired.

---

## Frontend pages

| `#1` | `#2` | URL |
|---|---|---|
| `index.html` | `frontend/pages/index.html` | `/` and `/index.html` |
| `about.html` | `frontend/pages/about.html` | `/about.html` |
| `catalogue.html` | `frontend/pages/catalogue.html` | `/catalogue.html` |
| `contact.html` | `frontend/pages/contact.html` | `/contact.html` |
| `admin-dashboard.html` | **moved to the administration console** *(separate repository)*, where it is that site's `index.html` | — |
| `store/store.html` | `frontend/pages/store/store.html` | `/store/store.html` |
| `store/checkout.html` | `frontend/pages/store/checkout.html` | `/store/checkout.html` |
| `blog/index.html + 8 articles` | `frontend/pages/blog/**` | `/blog/…` |

**No page URL changed.** They are the contract: every footer on the site links
them, they are in bookmarks, and a crawler has them. The only edit inside these
documents is the `src` on each `<script>` tag.

---

## Backend — `server.js` was 5,051 lines, and this is all of them

| `#1` | `#2` |
|---|---|
| `server.js` L1-15 (requires) | distributed - each file requires what it uses |
| `server.js` L17-44 (app, trust proxy, x-powered-by) | `backend/src/core/config/app-settings.js` |
| `server.js` L46-87 (CORS allow list) | `backend/src/core/http/cors.js` |
| `server.js` L89-124 (CSRF origin check) | `backend/src/core/http/csrf.js` |
| `server.js` L126-373 (CSP, Permissions-Policy, the per-document scan) | `backend/src/core/http/security-headers.js` |
| `server.js` L375-417 (body parsers, incl. the webhook `verify` hook) | `backend/src/core/http/body-parsing.js` |
| `server.js` L419-460 (session + the SESSION_SECRET refusal) | `backend/src/core/http/session.js` |
| `server.js` L461-547 (PRIVATE_PATH, X-Robots-Tag) | `backend/src/core/http/private-paths.js` |
| `server.js` L549-576, 591-642 (the legal shell route) | `backend/src/modules/legal/legal.module.js` |
| `server.js` L577-589 (`escapeHtmlText`) | `backend/src/shared/text.js` |
| `server.js` L644-655 (`express.static` on the project root) | `backend/src/core/http/static-files.js` - rewritten as four mounts read from `core/config/static-mounts.js` |
| `server.js` L657-669 (multer) | **moved to the administration console** *(separate repository)* — the only routes that upload are its own |
| `server.js` L671-829 (`roleNameById`, `sessionProfile`, `requireCustomer`) | `backend/src/core/security/guards.js` - plus `roleIdByName`, moved in from the auth module because it reads this file's private roles cache. `requireAdmin` is not here: it went to the console with the routes it guarded |
| `server.js` L830-836 (`authLimiter`) | `backend/src/modules/auth/infrastructure/auth-rate-limit.js` |
| `server.js` L838-840 (`GET /`) | `backend/src/core/http/static-files.js` |
| `server.js` L842-843 (the Supabase client) | `backend/src/core/database/supabase.js` |
| `server.js` L845-853 (`formLimiter`) | `backend/src/modules/enquiries/infrastructure/enquiry-rate-limit.js` |
| `server.js` L855-859 (`quoteLimiter`) | `backend/src/modules/quotes/infrastructure/quote-rate-limit.js` |
| `server.js` L861-1039 (`POST /api/submit-form`) | `backend/src/modules/enquiries/controllers/public-enquiries.controller.js` (+ `services/enquiry-redirect.service.js`) |
| `server.js` L1041-1103 (admin enquiries) | **moved to the administration console** *(separate repository)* |
| `server.js` L1105-1119 (quote vocabulary) | `backend/src/modules/quotes/domain/quote-status.js` |
| `server.js` L1121-1166 (`trimmed`, `EMAIL_PATTERN`, `MAX_LENGTHS`, `tooLong`, `optionalId`, `optionalNumber`) | `backend/src/shared/validation.js` |
| `server.js` L1168-1181 (`quoteReference`) | `backend/src/modules/quotes/domain/quote-reference.js` |
| `server.js` L1183-1367 (quote routes) | `backend/src/modules/quotes/controllers/public-quotes.controller.js`; the admin half **moved to the administration console** *(separate repository)* |
| `server.js` L1369-1575 (upcoming projects) | `backend/src/modules/projects/**` |
| `server.js` L1584-1591 (`slugify`) | `backend/src/shared/text.js` |
| `server.js` L1593-1621 (`countProductsByCategory`) | `backend/src/modules/products/infrastructure/product.repository.js` - it queries `products`, so the module that owns the table owns the query; categories holds it through `products.public.js` |
| `server.js` L1582, 1623-1665 (`CATEGORY_BUCKET`, `fetchCategoryRows`, `withImageUrl`) | `backend/src/modules/categories/infrastructure/category.repository.js` |
| `server.js` L1667-1847 (category routes) | `backend/src/modules/categories/controllers/public-categories.controller.js`; the admin half **moved to the administration console** *(separate repository)* |
| `server.js` L1862-1883 (`isMissingRelation`, `isMissingColumn`, `isPermissionDenied`) | `backend/src/core/database/postgrest-errors.js` |
| `server.js` L1885-1915 (`sendProductError`) | `backend/src/modules/products/services/product-errors.service.js` |
| `server.js` L1860, 1917-2010 (`PRODUCT_BUCKET`, image slots, `fetchProductRows`, `withProductImages`) | `backend/src/modules/products/{infrastructure,domain}/**` |
| `server.js` L2012-2330 (product routes) | `backend/src/modules/products/controllers/public-products.controller.js`; the admin half **moved to the administration console** *(separate repository)* |
| `server.js` L2341-2356 (`ORDER_STATUSES`) and L4054-4055 | `backend/src/shared/contracts/order-status.js` - three modules must agree on it and none owns all three transitions |
| `server.js` L2358-2456 (`fetchOrderRows`) | `backend/src/modules/orders/infrastructure/order.repository.js` |
| `server.js` L2458-2499 (admin orders) | **moved to the administration console** *(separate repository)* |
| `server.js` L2501-2807 (customers) | **moved to the administration console** *(separate repository)* — the whole module |
| `server.js` L2809-3368 (both auth doors) | `backend/src/modules/auth/**` |
| `server.js` L3370-3692 (`/api/orders/mine`, cancel) | `backend/src/modules/orders/controllers/customer-orders.controller.js` |
| `server.js` L3694-3918 (cart) | `backend/src/modules/cart/**` |
| `server.js` L3960-3974, 4057-4064 (GST, delivery, the two ceilings) | `backend/src/core/config/commercial.js` |
| `server.js` L3976-4008, 4043-4052 (`PAYMENT_METHODS`, `PAYMENT_MODES`, `CURRENCY`, `PAYMENT_STATUS`) | `backend/src/shared/contracts/payment.js` |
| `server.js` L4010-4041 (`PAYMENTS_ENABLED`, the boot assertion) | `backend/src/core/config/payments.js` |
| `server.js` L4086-4105 (`priceNumber`, `round2`) | `backend/src/shared/money.js` |
| `server.js` L4107-4206 (`priceCheckout`) | `backend/src/modules/checkout/services/price-checkout.service.js` |
| `server.js` L4208-4597 (checkout routes) | `backend/src/modules/checkout/controllers/checkout.controller.js` |
| `server.js` L4632-4635 (`orderReference`) + two inline copies at L3462 and L4520 | `backend/src/shared/contracts/order-reference.js` - one function replacing three copies, output byte-identical |
| `server.js` L4637-4795 (`gatewayPaymentRow`, `markOrderPaid`) | `backend/src/modules/payments/services/settle-payment.service.js` |
| `server.js` L4797-5027 (verify + webhook) | `backend/src/modules/payments/controllers/payments.controller.js` |
| `server.js` L5029-5048 (the `/api` default deny) | `backend/src/core/http/not-found.js` |
| `server.js` L5050-5051 (`listen`) | `backend/src/main.js` (`start()`), called by `backend/server.js` |
| `backend/src/razorpay.js` | `backend/src/core/gateways/razorpay.js` - an adapter for an external system, initialised once at boot, which is what core/ is for |
| `backend/src/totp.js` | **moved to the administration console** *(separate repository)* - it verified the code at that door and nothing else. Was: `backend/src/shared/security/totp.js` - a pure cryptographic helper with no domain knowledge |

---

## Carried unchanged

| `#1` | `#2` |
|---|---|
| `backend/migrations/*.sql` (27 files) | `backend/migrations/` - byte-identical |
| `backend/scripts/*` (7 files) | `backend/scripts/` - six of them, `require` paths updated for the gateway move. `enroll-admin-totp.js` went to the administration console |
| `backend/test/**` (8 files) | `backend/test/` - one `require` path updated in `authz.test.js`; the suites themselves are untouched, which is what makes them evidence |
| `backend/templates/legal-shell.html` | `backend/templates/` - script `src` attributes rewritten, nothing else |
| `backend/styles/tailwind.input.css` | `backend/styles/` |
| `backend/playwright.config.js` | `backend/` - unchanged; its paths were already relative to `backend/` |
| `backend/tailwind.config.js` | `backend/` - the six content globs became two recursive ones |
| `backend/package.json` | `backend/` - CSS output path, plus four `verify` scripts |
| `assets/**` (624 files) | `public/assets/` - byte-identical |
| `blog/**` (9 documents) | `frontend/pages/blog/` - script `src` attributes rewritten |
| `robots.txt` | `public/robots.txt` |
| `.gitignore`, `.gitattributes` | project root - unchanged |

---

## Not carried

| `#1` | Why |
|---|---|
| `AGENTS.md`, `CLAUDE.md` (349KB of working notes) | rewritten for this structure. `#1`'s originals are still in `#1` and remain the record of how the behaviour got the way it is. |
| `effervescent-jumping-hejlsberg.md`, `optimizer.prompt`, `filter-tab.txt`, `locator` | not carried. Scratch files; `filter-tab.txt` and `locator` were already denied by `PRIVATE_PATH`, and `locator` was an empty stub that answered 200. |
| `backend/logs/reconcile-2026-08.log` | not carried - operator output, and `.gitignore`d in both. |

---

## New in `#2`

| File | What it is |
|---|---|
| `backend/src/main.js` | The composition root — the one file that knows the whole application exists, and states the middleware order in a readable list. |
| `backend/src/core/config/paths.js` | Every filesystem root, resolved once. Nothing else may `path.join(__dirname, '..')` across a tier. |
| `backend/src/core/config/static-mounts.js` | The URL → folder table. Read by the server AND by `tools/verify-links.js`, so the two cannot disagree. |
| `backend/src/core/health/probes.js` | `/health/live` and `/health/ready`, kept strictly apart. The one thing the doctrine asks for that `#1` had no form of. |
| `backend/src/modules/*/[name].public.js` | Four published interfaces — the only files a sibling module may require. |
| `tools/verify-links.js` | Every `href`/`src` in every page and module resolves through the real mount table. |
| `tools/verify-boundaries.js` | The four import rules, enforced. |
| `tools/verify-boot.js` | Every file loads, and the route table matches `tools/api-surface.json` both ways. |
| `tools/verify.js` | All three, one command. |
| `tools/api-surface.json` | The routes this application serves, extracted mechanically from `#1`'s `server.js`. The ones that went to the console were removed in the commit that removed them from the app, so the both-ways check still holds. |
| `ARCHITECTURE.md` | Why the layout is what it is, and the deviations from the doctrine. |

---

## The eight edits to lifted code

Everything else was moved verbatim. These were not:

1. **`priceCheckout()`** queried `products` directly; it now calls
   `findActiveProductsByIds()` on `modules/products/products.public.js`. Same
   query, same `{ data, error }` shape — the difference is that the module that
   owns the table owns the statement.
2. **`fetchCategoryRows()`** called `countProductsByCategory()` as a local; it
   now imports it from the same published port, because that function reads the
   `products` table.
3. **`roleIdByName()`** moved from the auth module into
   `core/security/guards.js`. It reads `rolesCache`, which is private to that
   file, and exporting a cache for a module to walk publishes an implementation
   detail where publishing the question publishes an answer.
4. **Three inline `` `ORD-${year}-${order.order_number}` `` copies** became one
   `orderReference()` in `shared/contracts/order-reference.js`. Output is
   byte-identical; the risk removed is the day one of the three is corrected.
5. **`htmlPagesContaining()`** walked the whole project root and skipped
   `backend`, `node_modules` and dotfiles; it now walks `frontend/pages` and
   needs no skip list. It also scans the legal shell — see the note in
   `ARCHITECTURE.md`, this is the one behaviour difference in the project.
6. **The legal route** reads its two files through `core/config/paths.js`
   instead of `path.join(__dirname, '..')`.
7. **`express.static(projectRoot)`** became four mounts from the table.
8. **`assertBootConfig()`** was a top-level statement that could kill the
   process during a `require`; it is now `assertGatewayBootConfig()`, called
   explicitly by `main.js`'s `start()`. A `require` that can exit is a `require`
   no script or test can safely make.

Each is verifiable: `npm test` (103 assertions), `npm run test:browser` (53),
and `npm run verify` (three structural checks) all pass on `#2`.

---

## The ninth move: the administration console left

Everything above describes `#1` becoming `#2`. One later change moved a whole
vertical out of `#2` and into its own repository and deployment: the dashboard
document, its nine browser modules, the eight admin controllers, the
`customers` module entire, `order.repository.js`, `enquiry-status.js`, the
multer upload adapter, the TOTP verifier and its enrolment script — and
`requireAdmin`, which had nothing left to guard.

The rows above say **moved to the administration console** wherever that is
where a `#1` file ended up. `core/` and `shared/` were **copied** rather than
moved: both applications need them, and the copies are expected to drift.

The two applications share a Supabase project and nothing else — no session, no
cookie, no API call in either direction.
