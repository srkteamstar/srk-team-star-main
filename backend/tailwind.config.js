/*
 * tailwind.config.js — the build that replaced the browser compiler
 * ============================================================================
 *
 * Every page used to load /assets/vendor/tailwind-3.4.17.min.js: 400KB of
 * JavaScript, parsed and executed on each of 22 pages, whose entire job was to
 * scan the DOM and generate about 20KB of CSS. That work is identical on every
 * load and on every visit, and it happens on the visitor's machine, on the
 * critical path, before anything is styled.
 *
 * It also meant styling was blocked on JavaScript. A page whose script failed
 * — CSP refusal, a slow network, JS switched off — rendered as unstyled HTML
 * rather than as a plain-looking page.
 *
 * This config feeds the same Tailwind version, run once here, producing
 * /assets/vendor/tailwind.build.css. The pages link a stylesheet instead.
 *
 * THIS IS A BUILD STEP, IN A PROJECT THAT DELIBERATELY HAD NONE.
 * ---------------------------------------------------------------------------
 * That is a real change to how this repository works and it is worth being
 * honest about the cost: a class added to a page or a module will not appear
 * until `npm run build:css` is run again. Nothing else about the no-build-step
 * model changes — HTML, JS and the generated CSS are all still plain files
 * read off disk per request.
 *
 * Two things keep that cost small:
 *
 *   `npm run watch:css` rebuilds on save, which is the same reflex as
 *   `npm run dev` for the backend, and is named to rhyme with it.
 *
 *   The generated file is COMMITTED. A checkout runs with no build, exactly as
 *   before; the build is only needed by whoever changed a class.
 *
 * WHY SCANNING .js FILES MATTERS HERE
 * ---------------------------------------------------------------------------
 * This codebase builds most of its markup in JavaScript string literals —
 * product cards, overlays, the cart drawer, the admin tabs. Those classes
 * exist nowhere in the HTML, so a content list of *.html alone would generate
 * a stylesheet that looks complete and silently drops the entire store UI.
 *
 * Tailwind matches literal text, so this works only because no file here
 * assembles a class name from pieces (`'bg-' + colour`). Checked before making
 * the change: the only such construction anywhere in the project is inside the
 * vendored Tailwind bundle itself. KEEP IT THAT WAY — write the whole class
 * name out, and branch between two complete names rather than interpolating a
 * fragment, or the class will not survive the build.
 */
module.exports = {
    // THE TWO GLOBS THAT MATTER, AND WHY THEY ARE BOTH RECURSIVE.
    //
    // In `#1` these were six lines listing the site root, store/, blog/ and
    // legal/ separately, because the pages sat in four different places. They
    // now sit under one root, and the browser modules under another, so two
    // recursive globs cover everything and a new page or a new feature folder
    // is picked up without editing this file — which is exactly the kind of
    // list that goes stale silently and drops a whole surface's styling.
    //
    // The template is listed on its own because it lives under backend/: it is
    // server-rendered rather than served, so it is not below frontend/pages.
    content: [
        '../frontend/pages/**/*.html',
        './templates/*.html',
        '../frontend/js/**/*.js'
    ],

    // No theme extension, on purpose. The site's palette is written as Tailwind
    // arbitrary values inline — bg-[#12170f], text-[#d4af37] — several hundred
    // times across the pages and modules. Naming them here would create a
    // second way to say the same colour and leave both in the codebase, which
    // is the duplication this pass exists to remove rather than add to.
    theme: { extend: {} },

    // The generated sheet is loaded on every page, including ones with an
    // inline <style> block of their own, so the reset must land in the same
    // place the CDN build put it.
    corePlugins: { preflight: true }
};
