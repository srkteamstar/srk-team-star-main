# Expanded accessibility and SEO audit

Date: 31 August 2026. Target: current local storefront on `payment-test`, served at `http://127.0.0.1:3000`.

## Scope and limits

This was an inspection, not an implementation pass. No application code, product records, orders or settings were changed. The browser-control skill was used for rendered-page and keyboard inspection.

- Inspected source metadata across all 16 page documents and the shared legal shell.
- Inspected rendered home, store, catalogue, contact, about, blog index, one blog article, privacy policy and a product detail URL.
- Opened account, quotation and cart overlays without submitting forms or changing the cart.
- Checked desktop rendering and a 390 × 844 mobile viewport, then restored the viewport.
- Checked public HTTP responses, duplicate URL variants, robots directives and sitemap availability.
- Read the public catalogue to measure description coverage: 48 products, 43 missing descriptions.
- Calculated representative contrast ratios from rendered CSS colors, compositing alpha on solid backgrounds. Results involving gradients, overlapping transparent headers or reveal-animation timing were not treated as confirmed contrast failures.

This is **not a new Lighthouse/axe score or a WCAG conformance certification**. It does not include production Search Console, Google's rendered index, a full NVDA/VoiceOver/TalkBack session, every checkout/error state, or a complete 200–400% zoom/text-spacing audit. Checkout/payment response indexing headers were checked, but no live transaction was performed.

## Accessibility — confirmed issues

### A1. Low-contrast text — high priority

Representative rendered results:

| Location | Text | Measured ratio |
|---|---|---:|
| Account overlay | Gold “Create one” link | 1.96:1 |
| Account overlay | “Use your account identifier and password” | 2.36:1 |
| Account overlay | Introductory paragraph | 4.18:1 |
| Quote overlay | “Add as many as you need” / “Calculated securely” | 2.36:1 |
| Quote overlay | “Choose a product to check its live price.” | 2.72:1 |
| Blog cards | Reading times and dates | 3.12:1 |
| Featured blog article | Date / reading-time line | 3.60:1 |

These are normal-size text, for which the AA minimum is 4.5:1. Darken secondary text and use the darker brand-gold token for links on light backgrounds. Check placeholders, validation text and hover/focus states at the same time. Logo artwork is not included in these failures. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

Relevant sources: [shared overlay styles](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/storefront/shared/store-overlay-shared-module.js:66>), [account UI](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/account/profile-icon-loader.js:174>), [quotation pricing hint](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/quotes/request-quote-module.js:542>), [blog metadata](<E:/Surjeet Malik/SRK Team Star/#2/frontend/pages/blog/index.html:136>).

### A2. Custom quotation dropdown loses its field label — high priority

The visible category control is a `button[role="combobox"]`, but the existing label still targets the hidden native select. The enhancer copies `aria-label` only; it does not transfer the native select's associated label. The displayed value “Machinery” is not a substitute for the field name “Category.”

The custom control also lacks a relationship to the popup through `aria-controls`; arrow-key active-option changes are visual rather than communicated with `aria-activedescendant` or equivalent managed option focus.

Fix the shared enhancer: preserve the label, required/error/help relationships, popup ownership and active-option semantics. Test keyboard selection, Escape and screen-reader announcements without changing selected values or submission behavior. [W3C combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).

Source: [custom select enhancement](<E:/Surjeet Malik/SRK Team Star/#2/public/js/platform/custom-select-module.js:298>).

### A3. Opening the cart does not move focus inside it — high priority

After the cart was visibly open, focus remained on `#cart-button`, outside the dialog. The drawer has a label and an existing boundary focus trap, but opening it never establishes the starting focus. The trap only wraps when focus is already at its first/last internal control.

Move focus to the drawer heading or close button after rendering, keep focus inside while open, and preserve focus restoration on close. Account and product details already explicitly move focus; avoid replacing their working behavior. [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Sources: [drawer lifecycle](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/storefront/shared/store-overlay-shared-module.js:563>), [cart opening](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/cart/cart-module.js:1082>).

### A4. Featured carousel exposes hidden/offscreen controls — high priority

Both duplicated carousel slides have `aria-hidden="true"`, but their “View Product” anchors still have their normal keyboard tab stops. Real inactive slides also remain exposed instead of limiting interaction to the visible slide.

Make clones inert and remove their controls from sequential focus. Synchronize inactive-slide focusability and accessibility visibility with slide changes. Preserve navigation to the actual product.

Source: [featured slide markup](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/storefront/sections/featured-hero-loader.js:59>).

### A5. Product cards nest interactive controls inside a button role — high priority

The outer product article has `tabindex="0" role="button"`, while Buy Now, Request a price and cart buttons are inside it. Rendered inspection confirmed two nested buttons in priced product cards. This creates conflicting interactive semantics and can obscure internal structure in assistive technology.

Keep the article noninteractive; make the product title/image a real product link and keep purchase/quote buttons as siblings. This also improves SEO discovery. Preserve existing Enter/Space accessibility until the replacement is tested.

Source: [shared product card](<E:/Surjeet Malik/SRK Team Star/#2/public/js/shared/product-section-shared-module.js:319>).

### A6. Mobile-menu logo link has no accessible name — medium priority

On the landing page, the generated menu clones a decorative logo with `alt="" aria-hidden="true"` into a new anchor without a label. The normal header home link is named correctly; this generated mobile copy is not.

Give that anchor the accessible name “SRK Team Star Home.”

Source: [mobile menu construction](<E:/Surjeet Malik/SRK Team Star/#2/public/js/platform/responsive-navigation-module.js:280>).

### A7. Automatic landing hero has no explicit pause control — medium priority

The landing hero rotates automatically every 2.5 seconds but has no Pause/Play control. Reduced-motion support and offscreen pausing are good, but do not let a visitor pause it while reading the page in normal-motion mode.

Add an accessible Pause/Play control and retain the existing loading order. This finding concerns the automatic landing hero, not the manually navigated store carousel. [W3C pause/stop/hide guidance](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html).

Source: [landing hero gallery](<E:/Surjeet Malik/SRK Team Star/#2/public/js/modules/storefront/sections/machinery-hero-loader.js:15>).

### A8. Heading hierarchy needs cleanup — medium priority

- Home jumps from section headings at H2 to “Our Manufacturing Plant” at H5 and footer headings at H6.
- Store jumps from H2 to the plant heading at H4.
- Legal pages place a branding H4 before their H1.
- Article related-story headings are H2 peers of the “Related workshop insights” heading; H3 would better express that grouping.

Choose heading levels for document structure and keep the current font sizes through CSS. Do not add hidden headings just to satisfy a tool. The inspected pages already have primary headings; temporary opacity during reveal animations was not counted as a missing H1.

Source examples: [home headings](<E:/Surjeet Malik/SRK Team Star/#2/frontend/pages/index.html:503>), [legal shell](<E:/Surjeet Malik/SRK Team Star/#2/backend/templates/legal-shell.html:98>).

## Accessibility — additional improvements and validation work

1. **Visible form labels.** Home/catalogue/store enquiry fields now have accessible names, but visually rely on disappearing placeholders. Add persistent labels and required/optional hints without changing field names or validation.
2. **Input purpose/autofill.** The global no-suggestions module deliberately writes an unrecognized autocomplete token and disables suggestions. Consider allowing semantic `name`, `organization`, `email`, `tel` and address tokens on personal-information fields. This is an existing product preference and needs agreement, not a silent reversal. Preserve current sign-in/password-manager exceptions. [W3C input-purpose guidance](https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html).
3. **Carousel indicators.** Current hit areas are approximately 28 × 6 and 10 × 6 pixels. Enlarge the clickable areas, keeping the small visual dots if desired. They also use tab roles without associated tab panels/controls; use simple labeled buttons or implement the full tabs pattern. Small dimensions alone are not claimed as an automatic WCAG failure because spacing exceptions must be assessed.
4. **Mobile drawer behavior.** The main mobile menu has Escape handling and moves focus to its panel, but no Tab containment or explicit close control inside it. Decide on a consistent modal-drawer pattern, with background interaction disabled and an internal close button; verify with a real screen reader. Do not treat the absence of `inert` alone as proof of failure on every existing dialog.
5. **Progressive rendering and motion.** About/blog and other sections still start at `opacity:0` and depend on the scroll-reveal script. Make content visible by default, with animation as an enhancement and a robust no-JavaScript/reduced-motion fallback. Avoid putting focus on transparent content.
6. **Image descriptions.** Replace generic alternatives such as “Machine-card,” “Moulding-card” and “Hardware-card” with meaningful descriptions, or empty alt when the adjacent link/heading already provides the same information and the image is decorative. Avoid repeated product names in a single link's accessible name.
7. **Manual follow-up.** Verify 200–400% zoom, text spacing, keyboard-only completion, error-message association, focus visibility/obscuration, and NVDA/VoiceOver/TalkBack announcements. These were not exhaustively tested in this pass.

## SEO — confirmed gaps and recommended fixes

### S1. Product discovery through ordinary links — high priority

Most product cards use JavaScript button behavior rather than anchors pointing to product URLs. Featured-product links already use real URLs; extend that approach to the shared card renderer. Ensure each product is reachable from indexable catalogue/category pages without requiring a click handler to invent the destination. [Google crawlable-link guidance](https://developers.google.com/search/docs/crawling-indexing/links-crawlable).

### S2. Product-specific metadata and indexable detail content — high priority

The inspected URL `/store/store.html?product=5#all-products` opened Trim Craft details but retained:

- Title: `Store - SRK Team Star`.
- Description: the generic store description.
- H1: `SRK Team Star store`.
- No canonical or Product structured data.

Give each intended indexable product a consistent public URL, title, description, primary content and canonical. Existing query URLs can be retained; a cosmetic URL rewrite alone is not the fix. Prefer serving meaningful product content/metadata in HTML, while preserving the overlay UX and commerce logic.

### S3. Product content coverage — high priority

The public catalogue returned **48 products, of which 43 have an empty description**. Some rendered cards say “No description added.” Add accurate, product-specific descriptions, compatibility, dimensions/specifications where known, use cases and helpful images.

This needs approved product information. Do not invent specifications, prices, reviews or stock claims to fill SEO fields.

### S4. Canonical URLs and duplicate index routes — medium priority

No canonical tags were found in the 16 page files or legal shell. Both `/` and `/index.html` return 200, as do `/blog/` and `/blog/index.html`. These are duplicate URL variants, not broken pages.

Choose the preferred production origin/URL for each indexable page, add self-referencing canonicals and normalize duplicate index routes with redirects where appropriate. Coordinate product/filter/query URL handling rather than canonicalizing every product to the generic store. [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).

### S5. Sitemap missing — medium priority

`/sitemap.xml` returned 404 and robots.txt has no sitemap declaration. Generate a sitemap containing canonical, public marketing, article, category and product URLs, with truthful modification dates. Exclude checkout, payment, private API and arbitrary filter combinations. Submit it in Search Console after deployment. A sitemap aids discovery; it is not an indexing guarantee. [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

### S6. Structured data is incomplete — medium priority

Eight blog posts already contain BlogPosting JSON-LD with headline, dates, section, description and publisher name. They lack author and article-image information; the inspected product page has no Product schema, and the main pages have no Organization/WebSite schema.

Enrich article markup using verified author/image information; add appropriate organization and product markup that matches visible content. Add BreadcrumbList where real breadcrumb navigation exists. Do not fabricate offers for on-request products, reviews or ratings. Rich-result appearance is not guaranteed. [Google article structured-data guidance](https://developers.google.com/search/docs/appearance/structured-data/article).

### S7. Social-sharing metadata missing — medium priority enhancement

No Open Graph tags were found across the page files. Add `og:title`, `og:description`, `og:image`, `og:url` and appropriate card metadata using absolute public URLs. This primarily improves shared-link previews; it is not a promised direct ranking improvement.

### S8. More descriptive page titles and legal descriptions — lower priority

The landing title is only the brand name. Catalogue/store titles are generic. Write clear titles that identify the page's actual purpose without keyword stuffing. Public legal-shell pages lack meta descriptions; add page-specific summaries if they are intended to remain indexed.

Do not treat missing descriptions on checkout/payment as SEO defects: both correctly return `X-Robots-Tag: noindex, nofollow, noarchive`.

### S9. Reconcile robots.txt and noindex behavior — lower priority

Checkout is disallowed in robots.txt and also sends noindex. A crawler blocked from fetching the page cannot see its noindex response header. Decide the intended indexing policy for the nonsensitive checkout shell and verify it in Search Console; retain all authentication/privacy controls and private API protections. Do not blindly remove robots restrictions. [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## What is already working

- Main public pages have descriptions after the prior pass; blog posts have descriptive titles and descriptions.
- Representative pages have an English document language, a main landmark and a skip link.
- No unnamed normal-page buttons or missing `alt` attributes were found in the sampled settled page states. The generated mobile logo link is a separate confirmed exception.
- Maps have a descriptive outer iframe title.
- Account and quote dialogs have names and modal roles; account opening moves focus inside, and the tested end-of-form Tab wrapped to the close control.
- Product details are keyboard reachable, although the nested-control markup needs improvement.
- Enquiry status output has a polite live region.
- Blog article filtering exposes selected state and an announced result count.
- Checkout/payment are explicitly noindexed.
- About/blog routes resolve; historical notes saying those links 404 do not describe this current codebase.

## Recommended implementation order

1. Contrast tokens; custom dropdown label/keyboard semantics; cart initial focus.
2. Product-card links/semantics; hidden carousel controls; mobile logo name; landing hero pause.
3. Product descriptions and product-specific metadata/content, then canonical URL policy and sitemap.
4. Heading hierarchy, persistent labels, structured data and sharing previews.
5. Complete manual assistive-technology/zoom checks and run Lighthouse/axe against the deployed version, then verify indexing in Search Console.

A1–A8 and most presentation enhancements are local frontend work. Product data enrichment, public URL/canonical decisions, indexing policy and Search Console validation need content/production decisions. None were implemented by this audit.
