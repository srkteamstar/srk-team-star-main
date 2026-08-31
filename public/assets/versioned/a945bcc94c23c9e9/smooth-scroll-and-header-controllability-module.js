// ==========================================
// 2. SMOOTH SCROLL & HEADER CONTROLLER MODULE
// ==========================================
(() => {
    // Lenis is assumed to be loaded globally via a script tag in your HTML
    if (typeof Lenis === 'undefined') return; 

    const lenis = new Lenis({ lerp: 0.07, wheelMultiplier: 1 });

    // Published so anything that needs to move the page can go through the
    // scroller that actually owns it. Lenis animates its own target every frame,
    // so a plain window.scrollTo() from outside is overwritten on the next one —
    // view-state-restore-module.js reads this to put a refreshed page back where
    // it was instead of being dragged to the top.
    window.lenis = lenis;

    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    let isHeaderSolid = false;
    let isHeaderHidden = false;

    function raf(time) {
        lenis.raf(time);

        if (header && footer) {
            const scrollY = window.scrollY;
            const footerRect = footer.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            if (scrollY > 20 && !isHeaderSolid) {
                header.classList.remove('border-[#12170f]/10');
                header.classList.add('border-gray-100', 'shadow-sm');
                isHeaderSolid = true;
            } else if (scrollY <= 30 && isHeaderSolid) {
                header.classList.remove('border-gray-100', 'shadow-sm');
                header.classList.add('border-[#12170f]/10');
                isHeaderSolid = false;
            }

            if (footerRect.top < viewportHeight * 0.6 && !isHeaderHidden) {
                header.style.transform = 'translateY(-100%)';
                header.style.opacity = '0';
                header.style.pointerEvents = 'none';
                isHeaderHidden = true;
            } else if (footerRect.top >= viewportHeight * 0.6 && isHeaderHidden) {
                header.style.transform = 'translateY(0)';
                header.style.opacity = '1';
                header.style.pointerEvents = 'auto';
                isHeaderHidden = false;
            }
        }
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
})();