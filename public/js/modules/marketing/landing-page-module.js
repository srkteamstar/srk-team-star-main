/* Landing-page scroller and header. Hero copy is visible in the initial HTML. */
(() => {
    'use strict';
    const lenis = new Lenis({ lerp: 0.07, wheelMultiplier: 1 });
    window.lenis = lenis;
    const header = document.querySelector('header');
    const footer = document.querySelector('footer');
    let isHeaderSolid = false;
    let isHeaderHidden = false;

    function raf(time) {
        lenis.raf(time);
        if (header && footer) {
            const shouldBeSolid = window.scrollY > 20;
            if (shouldBeSolid !== isHeaderSolid) {
                header.classList.toggle('bg-transparent', !shouldBeSolid);
                header.classList.toggle('border-transparent', !shouldBeSolid);
                header.classList.toggle('bg-white', shouldBeSolid);
                header.classList.toggle('border-gray-100', shouldBeSolid);
                header.classList.toggle('shadow-sm', shouldBeSolid);
                isHeaderSolid = shouldBeSolid;
            }
            const shouldBeHidden = footer.getBoundingClientRect().top < window.innerHeight * 0.6;
            if (shouldBeHidden !== isHeaderHidden) {
                header.style.transform = shouldBeHidden ? 'translateY(-100%)' : 'translateY(0)';
                header.style.opacity = shouldBeHidden ? '0' : '1';
                header.style.pointerEvents = shouldBeHidden ? 'none' : 'auto';
                isHeaderHidden = shouldBeHidden;
            }
        }
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
})();
