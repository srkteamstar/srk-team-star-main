# Storefront visual alignment — 31 August 2026

## Scope and design reference

This is a UI-only pass on `payment-test`. The reference is the sibling
`admin-dashboard-srk` repository, specifically the inline theme in
`frontend/pages/index.html` and the hero, card and action patterns in
`frontend/js/modules/admin/shell/dashboard.js`.

No admin code, routes, authentication, data or deployment configuration is
imported into the storefront. Existing product imagery, authored content,
navigation destinations, control identifiers and script load order are retained.

| Element | Dashboard reference | Storefront application |
| --- | --- | --- |
| Canvas | `#f6f7f4` | Warm neutral ground across public pages and overlays |
| Ink / copy | `#12170f` / `#1f271b` | Feature panels, titles, body text |
| Accent | `#d4af37`, hover `#e4c55c` | Primary actions and active navigation keylines |
| Secondary accent | `#420c14` | Quote navigation and supporting actions |
| Gold text on light surfaces | Darker gold for small labels | `#80621a` for readable text; bright gold remains on dark features |
| Typography | Manrope / Schibsted Grotesk | Existing local fonts, consistent heading tracking |
| Geometry | 10px controls, 12–16px cards | 10px controls, 14px cards, 16px features |
| Elevation | Low-opacity green-black shadows | Quiet cards, stronger feature panels and drawers |
| Navigation | White rail, gold inset active line | Existing storefront rail and mobile navigation |

## Implementation boundary

`public/assets/styles/storefront-theme.css` is the complete visual layer.
Each of the 17 HTML documents has one screen-only stylesheet link and a
`data-srk-page` styling hook. Three existing heading containers additionally
use `srk-theme-hero`. The payment interstitial now loads the same local fonts.

All styles are within `@media screen`; the link also declares `media="screen"`.
Quotation and invoice print styles are unchanged. Existing JavaScript still
owns visibility, scroll locking, focus trapping, selection, validation,
carousel transitions, responsive navigation and every interaction.

No browser JavaScript, backend application code, migrations, dependencies,
commercial constants or payment configuration are changed by this pass.
No deployment or push is part of this work.

## Recovery point

Before the first file edit:

- Switched from `main` to the existing remote `payment-test` branch.
- Confirmed both branches pointed to the same code.
- Created local recovery branch `codex/storefront-ui-before-20260831`.
- Preserved commit `6eebb641afc152a518844a0f015c4ef64fec40d9`.
- The tracked worktree was clean. Pre-existing untracked attachments,
  artifacts, output folders and server logs were left untouched.

The recovery branch preserves the complete original tracked code, not a
memory-dependent reconstruction. `main` remains at that original commit too.

### Reverting the visual pass

Ask to restore the pre-redesign UI. First review the working tree for later
user edits; do not restore an entire folder indiscriminately. Restore only the
17 HTML files changed by this pass from the recovery commit, then remove the
now-unused theme stylesheet. Reverting any subsequent dedicated UI commit is
also appropriate if the work has been committed.

Simply switching branches while these changes are uncommitted does **not**
discard them. Do not use a hard reset or delete untracked files as a shortcut.

## Validation

The unchanged structural, API and browser suites passed before and after styling.
Final results: all three structural checks, 82 API assertions, 58 payment
assertions, and all 67 browser tests pass. The CSS build and root deployment-source
build also pass; the generated Tailwind file is unchanged.

The browser suite checks customer journeys, desktop/mobile overflow, navigation,
cart, checkout, payment tabs, quote and invoice printing, and script security.
The mobile menu retains its existing white surface and exact active gold tint.
No tests were changed to accommodate the redesign.

A source comparison against the recovery branch confirms all 17 documents are
identical after removing only the declared theme hooks. Application JavaScript,
backend logic, migrations and original tests have no diff. The theme stylesheet
parses successfully, with every rule inside the screen-only media boundary.

For ongoing work, run from `backend/`:

```text
npm run verify
npm test
npm run test:browser
```

The theme is plain CSS and does not depend on new Tailwind utilities. A normal
`npm run build:css` can still be run to validate the existing stylesheet build.

## Follow-up: remove decorative slashes

At the user's request, removed all ten triple-slash SVG decorations from the
home, catalogue, about and blog index pages. The surrounding SVG heading text,
horizontal rules, view boxes and layout remain unchanged. No styles or
application logic were changed in this follow-up. The site-wide source search
finds no remaining matching decorations, and all three structural checks pass.
