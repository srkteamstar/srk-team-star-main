(function () {
    'use strict';

    if (window.srkResponsiveNavigation) return;
    window.srkResponsiveNavigation = true;

    const css = `
        .srk-skip-link{position:fixed;top:.5rem;left:.5rem;z-index:10000;padding:.7rem 1rem;border-radius:3px;
            background:#12170f;color:#fff!important;font-weight:700;transform:translateY(-150%);transition:transform .15s ease}
        .srk-skip-link:focus{transform:translateY(0);outline:3px solid #d4af37;outline-offset:2px}
        .srk-mobile-menu-button,.srk-shell-menu-button,.srk-shell-menu-wrap,.srk-mobile-store-link{display:none}
        .srk-mobile-backdrop{position:fixed;inset:0;background:rgba(8,11,7,.68);z-index:70;border:0;padding:0;opacity:0;
            -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);transition:opacity .3s ease}
        .srk-mobile-backdrop[data-open="true"]{opacity:1}

        /* The public panel is deliberately the same object as the store's
           off-canvas sidebar below -- same width, same easing, same shadow --
           so a visitor who has opened one recognises the other. */
        /* overscroll-behavior: a panel long enough to scroll used to hand the
           gesture on to the page behind it the moment it ran out. This is the
           same rule scroll-lock-module.js publishes as .srk-scroll for every
           other overlaid scroller on the site; written out here because this
           panel's styling is a single block and splitting it across a class
           would be harder to read, not easier. */
        .srk-mobile-panel{position:fixed;top:0;left:0;bottom:0;z-index:80;display:flex;flex-direction:column;
            width:min(88vw,356px);height:100dvh;overflow-y:auto;overscroll-behavior:contain;
            background:linear-gradient(180deg,#fbfaf7 0%,#fff 58%);padding:0 1.25rem 1.25rem;
            border-right:1px solid rgba(212,175,55,.24);box-shadow:22px 0 60px rgba(8,11,7,.28);
            transform:translateX(-105%);transition:transform .32s cubic-bezier(.22,1,.36,1)}
        .srk-mobile-panel[data-open="true"]{transform:translateX(0)}
        .srk-mobile-panel__head{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:.75rem;
            min-height:88px;padding:1rem 0;margin-bottom:.8rem;border-bottom:1px solid rgba(18,23,15,.08);
            background:rgba(251,250,247,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
        .srk-mobile-panel__head img{height:48px;width:auto;user-select:none}
        .srk-mobile-panel__close{display:inline-flex;align-items:center;justify-content:center;flex:none;
            width:42px;height:42px;border:1px solid rgba(18,23,15,.1);border-radius:999px;background:#fff;
            color:#12170f;box-shadow:0 5px 18px rgba(18,23,15,.07);transition:color .3s ease,border-color .3s ease,background-color .3s ease,transform .3s ease}
        .srk-mobile-panel__close:hover{color:#fff;border-color:#12170f;background:#12170f;transform:rotate(4deg)}
        .srk-mobile-panel__close svg{stroke:#12170f;transition:stroke .25s ease}
        .srk-mobile-panel__close:hover svg{stroke:#fff}
        .srk-mobile-panel__group{display:flex;flex-direction:column;gap:.38rem;list-style:none;margin:0;padding:0}
        .srk-mobile-panel__group:before{content:"Explore";display:block;padding:.35rem .9rem .45rem;
            font-size:.66rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:rgba(31,39,27,.48)}
        /* Painted here rather than with utility classes: every page's inline
           <style> opens with a universal star rule setting colour on every
           element, and a direct match beats an inherited one. Same trap the
           store icon rules answer. */
        .srk-mobile-panel__group a{position:relative;display:flex;align-items:center;min-height:50px;padding:.75rem 2.2rem .75rem 1rem;
            border:1px solid transparent;border-radius:12px;font-size:.94rem;font-weight:650;color:#1F271B;
            transition:color .25s ease,background-color .25s ease,border-color .25s ease,transform .25s ease,box-shadow .25s ease}
        .srk-mobile-panel__group a:after{content:"›";position:absolute;right:1rem;top:50%;font-size:1.35rem;font-weight:400;
            color:rgba(31,39,27,.3);transform:translateY(-52%);transition:color .25s ease,transform .25s ease}
        .srk-mobile-panel__group a:hover{color:#9d7b10;background:#fff;border-color:rgba(212,175,55,.22);transform:translateX(3px)}
        .srk-mobile-panel__group a:hover:after{color:#d4af37;transform:translate(2px,-52%)}
        .srk-mobile-panel__group a[aria-current="page"]{color:#8d6c08;background:linear-gradient(90deg,rgba(212,175,55,.17),rgba(212,175,55,.07));
            border-color:rgba(212,175,55,.28);box-shadow:0 8px 22px rgba(92,70,8,.07)}
        .srk-mobile-panel__group a[aria-current="page"]:before{content:"";position:absolute;left:-1px;top:11px;bottom:11px;width:3px;border-radius:0 3px 3px 0;background:#d4af37}
        .srk-mobile-panel__foot{margin-top:auto;padding:1rem;border:0;border-radius:18px;background:#12170f;box-shadow:0 12px 30px rgba(18,23,15,.14)}
        .srk-mobile-panel__foot:before{content:"Talk to our team";display:block;margin-bottom:.65rem;font-size:.66rem;font-weight:800;
            letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.52)}
        .srk-mobile-panel__cta{display:flex;align-items:center;justify-content:space-between;border-radius:11px;
            background:#d4af37;padding:.82rem 1rem;font-size:.9rem;font-weight:750;color:#12170f;
            transition:background-color .25s ease,transform .25s ease}
        .srk-mobile-panel__cta:after{content:"↗";font-size:1rem;color:#12170f}
        .srk-mobile-panel__cta:hover{background:#e0bd4d;transform:translateY(-1px)}
        .srk-store-drawer-head{display:none}
        .srk-mobile-panel a:focus-visible,.srk-mobile-panel__close:focus-visible{outline:2px solid #d4af37;outline-offset:2px}

        @media (prefers-reduced-motion:reduce){
            .srk-mobile-panel,.srk-mobile-backdrop{transition:none}
        }

        @media (max-width:767px){
            html,body{max-width:100%;overflow-x:hidden}
            /* A BARE ICON, NOT A BORDERED WHITE BOX. index.html's header
               starts TRANSPARENT over the hero and only turns solid past 20px
               of scroll -- its own inline script owns that toggle. A button
               with its own white fill and border therefore sat on the hero
               photograph as a floating card with a hard edge, which is what
               read as broken. Bare, it behaves the way the desktop nav links
               already do on that same header: dark ink straight on whatever is
               behind, legible over both the light hero and the solid white
               state, with nothing of its own to misalign. 44px stays as the
               touch target; only the paint is gone. */
            .srk-mobile-menu-button,.srk-shell-menu-button,.srk-mobile-store-link{display:inline-flex;align-items:center;justify-content:center;
                width:44px;height:44px;border:0;border-radius:999px;background:transparent;color:#12170f;
                -webkit-tap-highlight-color:transparent;transition:background-color .2s ease}
            .srk-mobile-menu-button:hover,.srk-shell-menu-button:hover,.srk-mobile-store-link:hover{background:rgba(18,23,15,.06)}
            .srk-mobile-menu-button:active,.srk-shell-menu-button:active,.srk-mobile-store-link:active{background:rgba(18,23,15,.12)}
            .srk-mobile-menu-button:focus-visible,.srk-shell-menu-button:focus-visible,.srk-mobile-store-link:focus-visible{outline:2px solid #d4af37;outline-offset:2px}

            /* The button is pulled left by exactly the amount that puts the
               GLYPH on the page's own left margin (24px), not the invisible
               44px box edge. Header padding is 1rem and the 22px icon sits
               11px inside the box, so 16 - 3 + 11 = 24. Without it the icon
               floats 3px inboard of every heading under it, which is the kind
               of near-miss that reads as sloppy rather than as a choice. */
            .srk-public-header{padding-left:1rem!important;padding-right:1rem!important}
            .srk-mobile-menu-button{margin-left:-3px}
            /* The mirror of the hamburger's -3px, so the two glyphs sit on the
               page's left and right margins rather than on their box edges. */
            .srk-mobile-store-link{margin-right:-3px}

            /* The logo keeps the absolute centring it has on desktop. It used
               to be forced to position:static with auto margins here, which
               centred it in the space LEFT OVER beside the button instead of
               in the viewport -- 22px off centre at 390px, and further the
               narrower the screen. Leaving the desktop rule alone is both
               less code and the only version that is actually centred. */
            .srk-public-header>a img{height:46px!important}

            /* FOOTER BRAND BLOCK, CENTRED ON A PHONE ONLY.
               The footer is a 5-column grid on lg and the brand cell spans two
               of them, where left-aligned is right. Collapsed to one column on
               a phone that same cell became a 200px logo shoved against the
               left edge -- and pulled 4px PAST it by the -ml-4 that optically
               aligns it with the columns beside it on desktop, which is the
               one place that correction is wrong.

               Selected by the image's alt text rather than by its Tailwind
               classes: lg:col-span-2 is a layout coincidence that could be
               renamed, the alt text is the same string in all ten footers, and
               :has() lets the parent be reached without giving every page a
               new class. The tagline centres with it -- a centred logo over a
               left-ragged paragraph reads as a mistake rather than a layout,
               and the link columns below stay left-aligned as they should. */
            footer div:has(> img[alt="SRK Team Star Logo"]){align-items:center;text-align:center}
            footer img[alt="SRK Team Star Logo"]{margin-left:0!important}

            /* Three fixed-width cards side by side collapse to slivers on a
               phone; stacked they keep the picture legible. */
            .what-we-offer-content{flex-direction:column;gap:2rem!important}
            .what-we-offer-content>.container-card{width:100%!important;max-width:22rem}

            /* Upcoming Projects: the carousel is moved between the heading and
               the copy by upcomingProjectsOrder() below, so the section reads
               title -> picture -> copy -> actions instead of stranding the
               image under a wall of text. */
            .carousel-section[data-category="upcoming-projects"]{gap:0!important}
            /* The column's own rhythm, not the section's. Everything here was
               running at the info column's gap-3 (12px) once the carousel was
               moved inside it, which put the eyebrow, a 30px heading, a
               photograph, a paragraph and a button row all at the same 12px
               apart -- five different kinds of thing with nothing separating
               them. The picture gets the most air because it is the one block
               that is not text, and the action row gets a rule above it so it
               reads as the foot of the card rather than as one more line of
               copy. */
            .carousel-section[data-category="upcoming-projects"] .category-info{gap:1.125rem!important}
            .carousel-section[data-category="upcoming-projects"] .category-carousel{margin-top:.75rem;margin-bottom:1rem}
            .carousel-section[data-category="upcoming-projects"] .category-description{line-height:1.7}
            .carousel-section[data-category="upcoming-projects"] .cta-action-bar{justify-content:space-between;
                margin-top:.5rem;padding-top:1.25rem;border-top:1px solid rgba(18,23,15,.08)}
            /* The eyebrow rule crowded the heading under it at this size. */
            .carousel-section[data-category="upcoming-projects"] .category-title{margin-bottom:.125rem}

            .srk-store-shell{display:block!important;width:100%!important;min-width:0!important}
            /* An overlaid drawer at this width, and it scrolls: store.html's
               sidebar is overflow-y-auto in its own markup. overscroll-behavior
               stops a drag past its end being handed to the page behind — the
               same rule .srk-mobile-panel above carries, and the same one
               scroll-lock-module.js publishes as .srk-scroll. */
            .srk-store-sidebar{position:fixed!important;top:0;left:0;bottom:0;z-index:90!important;width:min(88vw,356px)!important;height:100dvh!important;
                display:flex!important;flex-direction:column!important;justify-content:flex-start!important;align-items:stretch!important;overflow-y:auto!important;overscroll-behavior:contain;
                padding:0!important;transform:translateX(-105%);transition:transform .32s cubic-bezier(.22,1,.36,1);
                background:linear-gradient(180deg,#fbfaf7 0%,#fff 58%)!important;border-right:1px solid rgba(212,175,55,.24)!important;
                box-shadow:22px 0 60px rgba(8,11,7,.28)}
            .srk-store-sidebar[data-open="true"]{transform:translateX(0)}
            .srk-store-drawer-head{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;
                min-height:78px;padding:1rem 1.25rem;border-bottom:1px solid rgba(18,23,15,.08);
                background:rgba(251,250,247,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
            .srk-store-drawer-head__copy{display:flex;flex-direction:column;gap:.12rem}
            .srk-store-drawer-head__eyebrow{font-size:.62rem;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#9d7b10}
            .srk-store-drawer-head__title{font-size:1.05rem;font-weight:750;letter-spacing:-.01em;color:#12170f}
            .srk-store-drawer-close{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;flex:none;
                border:1px solid rgba(18,23,15,.1);border-radius:999px;background:#fff;color:#12170f;box-shadow:0 5px 18px rgba(18,23,15,.07);
                transition:background-color .25s ease,color .25s ease,transform .25s ease}
            .srk-store-drawer-close:hover{background:#12170f;color:#fff;transform:rotate(4deg)}
            .srk-store-drawer-close svg{stroke:#12170f;transition:stroke .25s ease}
            .srk-store-drawer-close:hover svg{stroke:#fff}
            .srk-store-sidebar>div:not(.srk-store-drawer-head){width:100%!important}
            .srk-store-sidebar>div:nth-of-type(2){padding-top:1rem}
            .srk-store-sidebar>div:nth-of-type(2)>a{width:auto!important;min-height:92px;margin:0 1.25rem 1rem!important;
                border:1px solid rgba(18,23,15,.07);border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(18,23,15,.055)}
            .srk-store-sidebar>div:nth-of-type(2)>a img{width:112px!important;height:auto!important}
            .srk-store-sidebar #policy-nav{display:flex;flex-direction:column;gap:.38rem!important;padding:0 1.25rem!important}
            .srk-store-sidebar #policy-nav:before{content:"Browse";display:block;padding:.35rem .9rem .45rem;font-size:.66rem;font-weight:800;
                letter-spacing:.18em;text-transform:uppercase;color:rgba(31,39,27,.48)}
            .srk-store-sidebar #policy-nav li,.srk-store-sidebar #policy-nav-secondary li{transform:none!important;opacity:1!important}
            .srk-store-sidebar .nav-btn{position:relative;display:flex;align-items:center;min-height:50px;padding:.75rem 2.35rem .75rem 1rem!important;
                border:1px solid transparent;border-radius:12px!important;font-size:.94rem!important;font-weight:650!important;color:#1f271b!important;
                transition:color .25s ease,background-color .25s ease,border-color .25s ease,transform .25s ease,box-shadow .25s ease!important}
            .srk-store-sidebar .nav-btn:after{content:"›";position:absolute;right:1rem;top:50%;font-size:1.35rem;font-weight:400;
                color:rgba(31,39,27,.3);transform:translateY(-52%);transition:color .25s ease,transform .25s ease}
            .srk-store-sidebar #policy-nav .nav-btn:hover{color:#9d7b10!important;background:#fff!important;border-color:rgba(212,175,55,.22);transform:translateX(3px)}
            .srk-store-sidebar #policy-nav .nav-btn:hover:after{color:#d4af37;transform:translate(2px,-52%)}
            .srk-store-sidebar #policy-nav .nav-btn[class~="text-[#d4af37]"]{color:#8d6c08!important;
                background:linear-gradient(90deg,rgba(212,175,55,.17),rgba(212,175,55,.07))!important;
                border-color:rgba(212,175,55,.28);box-shadow:0 8px 22px rgba(92,70,8,.07)}
            .srk-store-sidebar #policy-nav .nav-btn[class~="text-[#d4af37]"]:before{content:"";position:absolute;left:-1px;top:11px;bottom:11px;
                width:3px;border-radius:0 3px 3px 0;background:#d4af37}
            .srk-store-sidebar>div:last-child{margin-top:auto;padding:1rem 1.25rem 1.25rem}
            .srk-store-sidebar #policy-nav-secondary{display:flex;flex-direction:column;gap:.4rem!important;padding:1rem!important;border:0!important;
                border-radius:18px;background:#12170f;box-shadow:0 12px 30px rgba(18,23,15,.14)}
            .srk-store-sidebar #policy-nav-secondary:before{content:"Personal support";display:block;padding:.1rem .2rem .45rem;font-size:.66rem;font-weight:800;
                letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.52)}
            .srk-store-sidebar #policy-nav-secondary .nav-btn{min-height:46px;padding:.68rem 2.2rem .68rem .8rem!important;color:#fff!important;border-color:rgba(255,255,255,.08)}
            .srk-store-sidebar #policy-nav-secondary .nav-btn:after{color:rgba(255,255,255,.48)}
            .srk-store-sidebar #policy-nav-secondary .nav-btn:hover{color:#12170f!important;background:#d4af37!important;border-color:#d4af37;transform:translateX(2px)}
            .srk-store-sidebar #policy-nav-secondary .nav-btn:hover:after{color:#12170f;transform:translate(2px,-52%)}
            .srk-store-main{width:100%!important;min-width:0!important}
            .srk-store-main>section{min-width:0!important}
            .srk-shell-menu-wrap{display:flex;position:sticky;top:0;z-index:45;align-items:center;gap:.85rem;padding:.75rem 1rem;
                background:rgba(255,255,255,.94);border-bottom:1px solid rgba(18,23,15,.08);box-shadow:0 8px 24px rgba(18,23,15,.055);
                -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
            .srk-shell-menu-wrap .srk-shell-menu-button{width:46px;height:46px;margin:0;background:#12170f;color:#fff;box-shadow:0 7px 18px rgba(18,23,15,.18)}
            .srk-shell-menu-wrap .srk-shell-menu-button:hover{background:#d4af37;color:#12170f}
            .srk-shell-menu-wrap .srk-shell-menu-button svg{stroke:#fff;transition:stroke .2s ease}
            .srk-shell-menu-wrap .srk-shell-menu-button:hover svg{stroke:#12170f}
            .srk-shell-menu-wrap strong{display:flex;flex-direction:column;font-size:.96rem;line-height:1.2;color:#12170f}
            .srk-shell-menu-wrap strong:after{content:"Products, quotes and support";margin-top:.2rem;font-size:.68rem;font-weight:500;color:rgba(31,39,27,.52)}
            #dynamic-view{min-width:0!important}
            #main-content{padding:1.25rem!important;min-width:0!important}
            .srk-legal-layout{display:block!important}
            .srk-legal-sidebar{position:static!important;width:100%!important;height:auto!important;padding:1rem!important;overflow-x:auto!important;border-bottom:1px solid rgba(18,23,15,.1)}
            .srk-legal-sidebar h4{margin-bottom:.6rem!important}
            .srk-legal-sidebar ul{display:flex!important;gap:.5rem!important;min-width:max-content}
            .srk-legal-sidebar li{padding-right:0!important}
            .srk-legal-sidebar .absolute{display:none!important}
            .srk-legal-sidebar button{white-space:nowrap;padding:.6rem .8rem!important;border:1px solid rgba(18,23,15,.12);border-radius:999px}
            #policy-content{width:100%!important;min-width:0!important;padding:2rem 1.25rem!important}
        }
    `;

    const MOBILE_QUERY = '(max-width: 767px)';

    function icon(label) {
        return '<span class="sr-only">' + label + '</span><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    }

    // A storefront, drawn to the hamburger's own spec so the two read as a
    // pair: same 22px box, same 24-unit viewBox, same currentColor stroke at
    // width 2, same round joins. Deliberately NOT the shopping bag the store
    // header uses for the cart — this goes to the shop, it does not hold
    // anything, and reusing the bag would promise a cart that is not there.
    function storeIcon(label) {
        return '<span class="sr-only">' + label + '</span><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18M3 9l2-5h14l2 5M5 9v11h14V9M10 20v-6h4v6"/></svg>';
    }

    function closeIcon(label) {
        return '<span class="sr-only">' + label + '</span><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    }

    function backdrop(close) {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'srk-mobile-backdrop';
        node.setAttribute('aria-label', 'Close menu');
        node.addEventListener('click', close);
        document.body.appendChild(node);
        // Flipped on the next frame so the element has a painted opacity:0 to
        // transition away from; setting it in the same frame skips the fade.
        window.requestAnimationFrame(() => node.setAttribute('data-open', 'true'));
        return node;
    }

    function fadeOut(node) {
        if (!node) return;
        node.removeAttribute('data-open');
        window.setTimeout(() => node.remove(), 250);
    }

    // THE PAGE IS HELD BY scroll-lock-module.js, NOT BY THIS FILE.
    //
    // Both panels this module opens are overlaid: the public nav panel and, on
    // a phone, the store sidebar, which the stylesheet above turns into an
    // off-canvas drawer at the same width and easing.
    //
    // The nav panel used to save and restore `document.body.style.overflow`
    // itself and the sidebars locked nothing at all. Three things were wrong
    // with that. `overflow:hidden` does not hold on iOS Safari, so a drag past
    // the end of a long panel scrolled the page underneath it. A private notion
    // of "nothing is open" cannot agree with the store overlays' one on the
    // pages that carry both — either closing restored a page the other was
    // still covering. And the sidebars, which are the same object drawn from a
    // media query rather than from JavaScript, were simply never considered.
    //
    // The fallback is the line this replaced, for a page that somehow loaded
    // without the module.
    function lockPage() {
        if (window.srkScrollLock) window.srkScrollLock.lock();
        else document.body.style.overflow = 'hidden';
    }

    function unlockPage() {
        if (window.srkScrollLock) window.srkScrollLock.unlock();
        else document.body.style.overflow = '';
    }

    // Same page, ignoring the query string and hash: /index.html and / are one
    // destination, and the header links to both spellings across the site.
    function isCurrentPage(link) {
        const here = window.location.pathname.replace(/\/index\.html$/, '/');
        const there = link.pathname.replace(/\/index\.html$/, '/');
        return here === there && !link.hash;
    }

    function publicNavigation() {
        const header = document.querySelector('header');
        const navs = header && header.querySelectorAll('nav[aria-label^="Main Navigation"]');
        if (!header || !navs || !navs.length) return;
        header.classList.add('srk-public-header');

        const links = Array.from(header.querySelectorAll('nav a'));
        const logo = header.querySelector(':scope > a img');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'srk-mobile-menu-button';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', 'Open main navigation');
        button.innerHTML = icon('Open main navigation');
        header.prepend(button);

        // Straight to the shop, on the right-hand end. It is APPENDED rather
        // than positioned: the header is `justify-between` and the two navs are
        // display:none on a phone while the logo is absolutely centred and out
        // of flow, so the hamburger and this are the only two items left in the
        // flow — which puts one at each end with no extra rule. On the store's
        // own pages it is skipped, because a link to the page you are already
        // on is a dead control.
        const onStore = /^\/store\//.test(window.location.pathname);
        if (!onStore) {
            const store = document.createElement('a');
            store.className = 'srk-mobile-store-link';
            store.href = '/store/store.html';
            store.setAttribute('aria-label', 'Store');
            store.innerHTML = storeIcon('Store');
            header.appendChild(store);
        }

        let panel = null;
        let shade = null;

        const close = () => {
            if (!panel) return;
            // Let the slide-out finish before the nodes go, so closing reads as
            // the same movement as opening rather than a disappearance.
            fadeOut(panel);
            fadeOut(shade);
            panel = shade = null;
            unlockPage();
            button.setAttribute('aria-expanded', 'false');
            button.focus();
        };

        const open = () => {
            shade = backdrop(close);
            panel = document.createElement('nav');
            panel.className = 'srk-mobile-panel';
            panel.setAttribute('aria-label', 'Mobile main navigation');

            const head = document.createElement('div');
            head.className = 'srk-mobile-panel__head';
            if (logo) {
                const home = document.createElement('a');
                home.href = '/index.html';
                const mark = logo.cloneNode(true);
                mark.removeAttribute('class');
                home.appendChild(mark);
                head.appendChild(home);
            }
            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'srk-mobile-panel__close';
            dismiss.setAttribute('aria-label', 'Close navigation');
            dismiss.innerHTML = closeIcon('Close navigation');
            dismiss.addEventListener('click', close);
            head.appendChild(dismiss);
            panel.appendChild(head);

            // The header CTA becomes the panel footer action, mirroring the
            // store sidebar: a primary list, then a ruled-off secondary one.
            const group = document.createElement('ul');
            group.className = 'srk-mobile-panel__group';
            const foot = document.createElement('div');
            foot.className = 'srk-mobile-panel__foot';

            links.forEach(source => {
                const link = source.cloneNode(true);
                const isCta = source.classList.contains('quote-nav-cta');
                link.removeAttribute('class');
                if (isCurrentPage(source)) link.setAttribute('aria-current', 'page');

                if (isCta) {
                    link.className = 'srk-mobile-panel__cta';
                    foot.appendChild(link);
                    return;
                }
                const item = document.createElement('li');
                item.appendChild(link);
                group.appendChild(item);
            });

            panel.appendChild(group);
            if (foot.childElementCount) panel.appendChild(foot);
            panel.addEventListener('click', event => { if (event.target.closest('a')) close(); });

            lockPage();
            document.body.appendChild(panel);
            window.requestAnimationFrame(() => panel.setAttribute('data-open', 'true'));
            button.setAttribute('aria-expanded', 'true');
            panel.querySelector('a')?.focus();
        };

        button.addEventListener('click', () => (panel ? close() : open()));
        document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }

    // Reads title -> picture -> copy -> actions on a phone. Done by moving the
    // node rather than with CSS `order`, because the two sit in different flex
    // containers and `display:contents` on the info column would drop the box
    // its scroll-reveal animates.
    function upcomingProjectsOrder() {
        const section = document.querySelector('.carousel-section[data-category="upcoming-projects"]');
        if (!section) return;

        const carousel = section.querySelector('.category-carousel');
        const heading = section.querySelector('.category-heading');
        if (!carousel || !heading) return;

        const homeParent = carousel.parentElement;
        const homeNext = carousel.nextSibling;
        const query = window.matchMedia(MOBILE_QUERY);

        // Everything image-slider-module.js looks up is scoped to
        // `.carousel-section` with querySelector, so the node stays reachable
        // from either position, and its layout is transform-based rather than
        // measured off the container.
        const apply = () => {
            if (query.matches) {
                if (carousel.previousElementSibling !== heading) heading.after(carousel);
            } else if (carousel.parentElement !== homeParent) {
                homeParent.insertBefore(carousel, homeNext);
            }
        };

        apply();
        query.addEventListener('change', apply);
    }

    function offCanvasShell(shell, sidebar, main, kind) {
        if (!shell || !sidebar || !main) return;
        shell.classList.add('srk-' + kind + '-shell');
        sidebar.classList.add('srk-' + kind + '-sidebar');
        main.classList.add('srk-' + kind + '-main');

        // Hidden outside the mobile media query by the base rule at the top of
        // `css` -- a bare <div> is display:block by default, which left the
        // words "Store navigation" sitting above the page on desktop.
        const wrap = document.createElement('div');
        wrap.className = 'srk-shell-menu-wrap';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'srk-shell-menu-button';
        button.innerHTML = icon('Open section navigation');
        button.setAttribute('aria-label', 'Open section navigation');
        button.setAttribute('aria-expanded', 'false');
        if (!sidebar.id) sidebar.id = 'srk-' + kind + '-navigation';
        button.setAttribute('aria-controls', sidebar.id);
        wrap.appendChild(button);
        const label = document.createElement('strong');
        label.textContent = kind === 'store' ? 'Browse store' : 'Section navigation';
        wrap.appendChild(label);
        main.prepend(wrap);

        let shade = null;

        // Guarded, because close() is reachable from Escape and from a click
        // inside the sidebar whether or not it is open, and an unlock that runs
        // when nothing locked would decrement a count another surface is
        // holding — releasing the page under a cart drawer that is still there.
        let sidebarOpen = false;
        let sidebarDismiss = null;

        const close = () => {
            if (!sidebarOpen) return;
            sidebarOpen = false;
            sidebar.removeAttribute('data-open');
            fadeOut(shade);
            shade = null;
            unlockPage();
            button.setAttribute('aria-expanded', 'false');
            button.focus();
        };

        if (kind === 'store') {
            const drawerHead = document.createElement('div');
            drawerHead.className = 'srk-store-drawer-head';

            const copy = document.createElement('div');
            copy.className = 'srk-store-drawer-head__copy';
            const eyebrow = document.createElement('span');
            eyebrow.className = 'srk-store-drawer-head__eyebrow';
            eyebrow.textContent = 'SRK Team Star';
            const title = document.createElement('strong');
            title.className = 'srk-store-drawer-head__title';
            title.textContent = 'Store menu';
            copy.append(eyebrow, title);

            sidebarDismiss = document.createElement('button');
            sidebarDismiss.type = 'button';
            sidebarDismiss.className = 'srk-store-drawer-close';
            sidebarDismiss.setAttribute('aria-label', 'Close store navigation');
            sidebarDismiss.innerHTML = closeIcon('Close store navigation');
            sidebarDismiss.addEventListener('click', close);

            drawerHead.append(copy, sidebarDismiss);
            sidebar.prepend(drawerHead);
        }

        button.addEventListener('click', () => {
            if (sidebarOpen) return;
            sidebarOpen = true;
            sidebar.setAttribute('data-open', 'true');
            button.setAttribute('aria-expanded', 'true');
            shade = backdrop(close);
            lockPage();
            window.requestAnimationFrame(() => sidebarDismiss?.focus());
        });
        sidebar.addEventListener('click', event => {
            if (event.target.closest('a,button') && window.innerWidth < 768) window.setTimeout(close, 0);
        });
        document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }

    function init() {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        const main = document.querySelector('main');
        if (main) {
            if (!main.id) main.id = 'srk-main-content';
            if (!document.querySelector('.srk-skip-link')) {
                const skip = document.createElement('a');
                skip.className = 'srk-skip-link';
                skip.href = '#' + main.id;
                skip.textContent = 'Skip to main content';
                document.body.insertBefore(skip, document.body.firstChild);
            }
        }
        publicNavigation();
        upcomingProjectsOrder();

        const legalContent = document.getElementById('policy-content');
        if (legalContent) {
            const layout = legalContent.closest('main')?.querySelector('main > section') || legalContent.parentElement?.parentElement;
            const sidebar = document.getElementById('policy-nav')?.closest('section');
            layout?.classList.add('srk-legal-layout');
            sidebar?.classList.add('srk-legal-sidebar');
        }

        const storeNav = document.querySelector('button[data-policy="all-products"]');
        if (storeNav) {
            const sidebar = storeNav.closest('header');
            offCanvasShell(sidebar?.parentElement, sidebar, sidebar?.nextElementSibling, 'store');
            const combos = document.querySelector('button[data-policy="combos"]');
            combos?.closest('li')?.remove();
            // Keep the nodes mounted because the page's legacy slider listener
            // still wires them later in DOMContentLoaded; hiding the owning
            // article removes the unfinished promise without causing null
            // errors that would abort the rest of the store boot sequence.
            const bundleArticle = document.getElementById('bundle-slider')?.closest('article');
            if (bundleArticle) bundleArticle.hidden = true;
            document.querySelectorAll('article').forEach(article => {
                const heading = article.querySelector('h2');
                if (heading && /complete sets/i.test(heading.textContent || '')) article.hidden = true;
            });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
