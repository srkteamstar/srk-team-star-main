// ==========================================
// 4. SCROLL REVEAL MODULE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    let delay = 0;
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const el = entry.target;
                setTimeout(() => {
                    el.classList.remove('opacity-0', '-translate-y-6');
                    setTimeout(() => {
                        el.classList.remove('transition-all', 'duration-[1000ms]', 'ease-out', 'scroll-reveal');
                    }, 1000);
                }, delay);
                delay += 100;
                observer.unobserve(el);
            }
        });
        setTimeout(() => delay = 0, 25);
    }, { threshold: 0.15 });

    document.querySelectorAll('.scroll-reveal').forEach((el) => observer.observe(el));
});