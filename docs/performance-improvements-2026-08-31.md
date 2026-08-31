# Storefront performance improvements — 31 August 2026

## Scope and recovery

- Implemented locally on `payment-test`; not deployed or pushed.
- Recovery branch: `codex/performance-before-20260831`, pointing to `81a49396daa425c92d8c7349b9bc889eade43b0d` (the committed design before this performance pass).
- All original image files remain unchanged. The image manifest verifies their SHA-256 hashes.
- Existing unrelated working files and the prior visual-theme notes were preserved. A recovery branch records committed code, not unrelated uncommitted files; do not use a destructive whole-workspace reset to undo this pass.
- The Sites skill's existing-project guidance was used to retain this application's structure and design, without a framework migration or deployment.

## Fixed

1. **Selected local image delivery.** Seven PNGs used in page content now have responsive WebP copies. The favicon is a smaller PNG, not WebP. There are 20 generated variants in total. Existing AVIFs, unused archive artwork and all Supabase originals are untouched.
2. **Responsive sizing.** Local image markup now includes `srcset`, `sizes`, dimensions and asynchronous decoding. Below-fold local content images use native lazy loading. Logos remain eager. Original content and framing are retained; images were resized/compressed, not AI-redrawn.
3. **First hero image priority.** The first selected machinery image is requested eagerly with `fetchpriority="high"`. Its original Supabase URL is used unchanged.
4. **Deferred remaining hero images.** Later slides have no `src` initially. After the first image loads and decodes, the gallery starts preparing one slide ahead at low priority. It keeps the current slide visible if the next image is slow, recovers from a failed image, and pauses scheduling when offscreen or in a hidden tab. Reduced-motion visitors download only the first slide, matching the existing non-rotating mode.
5. **Immediate landing copy.** The heading, description and calls to action no longer start invisible or wait for character-by-character timers. They remain visible with JavaScript disabled. Smooth scrolling and the header's transparent/solid behavior are preserved in a separate module.
6. **Reduced parser blocking.** Scripts on the landing, about, contact, catalogue, blog and legal-shell pages now use ordered `defer`. Shared dependencies remain ordered and view-state restoration stays last. The store and checkout retain their existing parser-time order because inline code depends on it.
7. **Lower-priority upcoming-project images.** These use lazy loading, async decoding and low fetch priority, without changing their remote URLs or carousel controls.
8. **Font discovery.** The two normal Latin fonts used by the design are preloaded, with matching versioned URLs and CORS mode. Existing self-hosting, Unicode subsets and `font-display: swap` remain intact; unused font subsets are not preloaded.
9. **Safe long-lived static caching.** HTML references content-hashed JS/CSS/font copies. Generated assets and image variants receive one-year immutable caching locally; equivalent Vercel configuration is prepared. HTML and stable JS/CSS continue revalidating. Session, customer, checkout, payment and API cache policies are not relaxed.
10. **Accessible names.** Floating WhatsApp links have an accessible name. Placeholder-only enquiry fields have explicit accessible names, while existing labels, identifiers, validation and submission behavior are retained.
11. **Missing search descriptions.** Added descriptions for the landing, about, catalogue, contact and store pages. Existing blog descriptions remain unchanged.
12. **Build safeguards.** Asset manifests, hash checks, stable cross-platform line endings and a stale-build check protect against mismatched source/generated files. Normal builds do not require Sharp; only regenerating image conversions does.

## Measured local file sizes

Comparison uses the largest generated variant for each image, not an assumed mobile download or a Lighthouse estimate. KiB = 1,024 bytes. Browsers may choose a smaller responsive variant.

| Local image | Original | Largest new version | Reduction |
|---|---:|---:|---:|
| Blog feature image (`hero-image.png`) | 2,352.7 KiB | 116.6 KiB | 95% |
| Machinery card | 231.5 KiB | 14.5 KiB | 94% |
| Frame-moulding feature | 1,259.3 KiB | 18.4 KiB | 99% |
| Hardware card | 298.1 KiB | 15.2 KiB | 95% |
| Hardware feature | 1,205.4 KiB | 16.7 KiB | 99% |
| Frame-moulding card | 318.8 KiB | 18.7 KiB | 94% |
| Transparent logo | 315.4 KiB | 20.8 KiB | 93% |
| Favicon (still PNG) | 52.9 KiB | 2.9 KiB | 94% |

Across these unique files: **6,178,797 → 229,297 bytes**, approximately **96.3% smaller**. This is not a per-page transfer total: pages use different subsets, and remote images are excluded.

## Not fixed, or only partly addressed

1. **Supabase image sizes/formats and their cache headers:** deliberately unchanged as requested. Large remote images may still dominate the image-delivery warning. Staged loading reduces competition but does not shrink a remote file.
2. **Full hero request discovery:** partially addressed through early deferred execution and priority. The first URL still depends on the existing public product/category responses. It is not embedded in the initial HTML. Completing this would need a coordinated server-rendered or published hero-image snapshot that stays in sync with dashboard selection; no product was hard-coded or category logic bypassed.
3. **Production TTFB/document latency:** no claim of a fix. Hosting cold starts, deployment region, database proximity and live response timings need production measurement. Database behavior, session middleware and hosting-region settings were not changed speculatively.
4. **All render-blocking resources:** parser-blocking scripts were reduced on the public pages; essential CSS still blocks rendering normally. The store/checkout inline-script dependencies were not rewritten. Further CSS extraction and script splitting need a measured production trace.
5. **Third-party warnings:** Google Maps and the payment provider remain functional. Existing lazy map loading was retained; no consent gate or delayed payment initialization was introduced. Their server/cache policies are outside this change.
6. **A perfect accessibility/SEO score:** specific accessible-name and description gaps were fixed. The screenshots do not include all expanded failing audits, so remaining contrast, semantics and search findings need the detailed report and a fresh run. No claim of 100/100 is made.
7. **Agentic Browsing 1/2:** the screenshot does not identify the failing sub-check. No speculative crawler files or behavioral changes were added.
8. **Live cache verification and new PageSpeed/Core Web Vitals scores:** not available before deployment. No production deployment was performed. Re-run mobile and desktop PageSpeed after release; real-user field results reflect a rolling 28-day window and will not change instantly.

## Verification completed

- Root production asset/build check: passed; all 50 referenced versioned assets and local-image variants current across 17 documents.
- Structural verification: all three checks passed; links resolve, module boundaries hold, and the API route surface is unchanged.
- API/security assertions: 82 passed; payment assertions: 58 passed (140 total).
- Browser journeys: 75 passed (67 existing plus 8 new performance regressions).
- New tests cover hero request order/priority, slow-image handling, error recovery, reduced motion, no-JavaScript hero visibility, cache headers, accessible names, deferred-script order, font preloads and responsive blog images.
- Existing journeys cover cart actions, customer/guest flows, checkout, online payment success/failure, quotations, invoices, navigation, mobile layout and CSP.
- Optimized hero artwork and logo inspected locally. Original/variant integrity and whitespace checks passed.
- Tests use the repository's isolated fixtures, not live orders or payments. No new production Lighthouse score was measured.

## Editing and release notes

- Continue editing original files, not `public/assets/versioned/` copies. Run root `npm run build:assets` after browser JS/CSS changes. `backend`'s `npm run build:css` now also refreshes asset references.
- Commit source changes, generated assets and manifests together; Vercel discovers static files before its optional build command. Run root `npm run build` and backend verification/tests before publishing.
- Restart the local backend to activate its changed cache policy. HTML/static asset changes alone are read from disk.
- For rollback, use the recovery branch as the source for a scoped revert of this pass, preserving any later/unrelated work. All image originals are already present.

The loading strategy follows [Google's LCP guidance](https://web.dev/articles/optimize-lcp) and [fetch-priority guidance](https://web.dev/articles/fetch-priority). The generated-asset cache policy follows [Vercel's cache-control guidance](https://vercel.com/docs/caching/cache-control-headers).
