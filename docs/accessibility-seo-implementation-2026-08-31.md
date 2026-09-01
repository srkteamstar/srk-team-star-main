# Accessibility and SEO implementation report

Date: 31 August 2026. Branch: `payment-test`.

This implements the code-level findings in `accessibility-seo-audit-2026-08-31.md`.
No production deployment, database/content write, migration, live transaction or
Search Console submission was performed. Existing commerce behavior was retained
in this pass. Separate checkout/idempotency commits appeared on the branch during
implementation; those changes were preserved, not reverted or attributed to this pass.

## Fixed — accessibility

- **A1, text contrast:** darker brand-gold links and readable secondary text on
  light surfaces; improved placeholders. Automated rendered-color checks confirm
  at least 4.5:1 for the previously flagged account link/hint, quotation hint and
  featured-blog date line. This is a representative check, not certification of
  every color/state/background combination.
- **A2, custom dropdowns:** native labels are associated with the visible
  combobox; required, help and error attributes are mirrored. Popup ownership and
  active-option relationships are exposed; existing value/change behavior is kept.
- **A3, cart focus:** opening the drawer focuses its close control; keyboard
  containment and focus restoration are tested.
- **A4, carousel visibility:** duplicate and inactive featured slides are inert
  and excluded from sequential keyboard focus. Only the current slide is exposed.
- **A5, product semantics:** articles no longer pretend to be buttons containing
  other buttons. Product image/title links are separate from purchase/quote controls.
  Normal clicks and keyboard activation retain the existing details overlay.
- **A6, mobile navigation name:** the cloned home link has an accessible name.
  Mobile navigation dialogs are named and have an internal close button, Tab
  containment, Escape handling and background inertness. Closing the store menu
  preserves focus when the quotation dialog takes over.
- **A7, motion control:** the landing slideshow has Pause/Play, keeps reduced-motion
  behavior and retains first-image priority plus deferred later-image loading.
- **A8, structure:** corrected plant/footer/related-story heading levels without
  changing their visual hierarchy; legal branding is no longer a misplaced heading.
- Persistent enquiry labels, required/optional hints and personal-information
  autocomplete tokens. Existing password-manager exceptions remain intact.
- Featured-carousel indicators use ordinary stateful buttons with 44px targets.
- Reveal-dependent content remains visible without JavaScript. Skip links are in
  the HTML, and catalogue/store pages offer a no-JavaScript product-directory link.
- Meaningful alternatives replace generic category-image labels; decorative
  divider gradients have unique identifiers.

## Fixed — SEO and public discovery

- **S1–S2:** real product links plus read-only server-rendered `/products/` and
  `/products/:slug` pages. Each detail page has its product name, description or
  factual fallback, primary image when available, breadcrumb and a link back to
  the existing store purchase/quote flow. Missing products return 404; temporary
  catalogue failures return 503 instead of an empty successful product page.
- Legacy `/store/store.html?product=ID` bookmarks retain their overlay behavior
  and receive product-specific metadata and a preferred product-page canonical
  when the public origin is configured.
- **S4–S5:** configured-origin canonicals and an XML sitemap of canonical public
  marketing, article, legal and product URLs. Duplicate index-document spellings
  point to the same canonical. Checkout, payment, APIs and arbitrary query/filter
  combinations are excluded. No fabricated modification dates are published.
- **S6:** informational Product and visible BreadcrumbList data; homepage
  Organization/WebSite data; article images and page identity supplement existing
  BlogPosting markup. Dynamic structured data is escaped and receives exact CSP
  hashes without an unsafe-inline script permission.
- **S7:** Open Graph and social-card titles/descriptions and available image/URL
  metadata. Absolute local image URLs are emitted once `SITE_ORIGIN` is configured.
- **S8:** descriptive home/catalogue/store titles, legal descriptions and metadata
  synchronization during legal-page navigation and browser Back.
- **S9:** checkout is no longer blocked from crawling its existing noindex directive.
  The API crawl restriction and all application authentication/privacy controls remain.
- Selected local-image optimizations and immutable asset versioning from the prior
  performance pass are preserved. No Supabase images were converted or rewritten.

## Still requires input or production validation

1. **Public domain:** confirm and configure `SITE_ORIGIN`. The sitemap intentionally
   returns 503 when this is missing/invalid; canonicals are omitted rather than
   guessing a production host. The automated tests use a test-only example domain.
2. **Robots sitemap declaration:** add the absolute sitemap URL after the public
   domain is confirmed, then deploy and submit the sitemap in Search Console.
3. **Product copy (S3):** 43 of 48 products lacked stored descriptions in the audit.
   Generic missing-description messages have factual product/category fallbacks,
   but approved specifications, dimensions, compatibility and useful original copy
   must still be supplied. No product records were changed.
4. **Article attribution:** confirmed author names/profile links are still needed.
   The existing publisher is retained; an author is not invented.
5. **Rich product results:** informational Product markup is present, but no
   offer/rating/review data is invented merely to qualify for rich results.
6. **Redirect policy:** existing index URLs continue to work and share canonicals.
   No forced production-origin or duplicate-index redirects were deployed.
7. **Manual assistive-technology and production checks:** NVDA, VoiceOver,
   TalkBack, complete zoom/text-spacing/error-state review, a fresh deployed
   Lighthouse/axe run, Rich Results Test and Search Console inspection remain.
   A 320px product-page reflow/text-spacing check and keyboard regressions are
   covered locally. No new accessibility/SEO score is claimed.

## Verification

Targeted browser coverage includes dropdown labels/active options, initial cart
focus, product-link semantics, inactive slides, mobile modal navigation, slideshow
pause/play, no-JavaScript content, input purpose, canonical/social tags, public
product schema and errors, sitemap exclusions, article metadata, 320px reflow,
legal history navigation, menu-to-quote focus, and representative text contrast.

Security tests check trusted-origin validation, metadata escaping, CSP hashing,
checkout/payment exclusion and the public product projection, including the
existing product-9 test-price safeguard. API/payment suites use the isolated fake
catalogue and gateway harness, not live transactions.

Final results on the combined current branch:

- Browser suite: **91 passed**, including 16 new accessibility/SEO cases.
- API suite: **91 assertions passed**.
- Payment suite: **59 assertions passed**.
- SEO/security unit suite: **5 tests passed**.
- All three structural checks passed: links, boundaries and boot/route contract.
- CSS/asset generation and the root production asset verification passed.

Browser testing used a fresh isolated harness on port 3459. The harness now
rejects stale test servers rather than silently testing a prior process. The
existing local development server was not stopped or restarted, so it needs a
restart to load backend changes. No deployed score or live indexing improvement
is asserted from these local results.

## Rollback and coexistence

Before this pass, the branch was verified as `payment-test` at
`81a49396daa425c92d8c7349b9bc889eade43b0d`. A file-copy snapshot preserves the
then-modified and relevant untracked files in
`artifacts/rollback-before-accessibility-seo-20260831/`; unchanged tracked files
remain recoverable from that original commit. This captures the earlier
uncommitted performance work, which a branch pointer alone would not preserve.

The branch gained additional commits during this pass, including independent
checkout fixes. **Do not reset the whole branch to the old commit.** A rollback
should restore only this pass's affected files/hunks from the snapshot/baseline,
preserve subsequent unrelated changes, rebuild assets and rerun verification.
Nothing was deleted to create the snapshot.

## References

Implementation follows the [W3C ARIA patterns](https://www.w3.org/WAI/ARIA/apg/patterns/),
[Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)
and [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).
The Sites skill's existing-project guidance was used to retain the existing
Express/vanilla-JavaScript stack; no hosting migration or publication was performed.
