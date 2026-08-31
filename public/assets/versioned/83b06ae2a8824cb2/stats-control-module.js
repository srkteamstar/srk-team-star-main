document.addEventListener('DOMContentLoaded', () => {
    const easeInOutQuart = (t) => t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
    const stats = document.querySelectorAll('.statistics-container h3');

    const statObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const el = entry.target;
                const isNumeric = el.dataset.isNumeric === 'true';

                if (isNumeric) {
                    const target = parseFloat(el.dataset.target);
                    const suffix = el.dataset.suffix || '';
                    const duration = 1500;
                    let startTime = null;

                    const animateNumber = (timestamp) => {
                        if (!startTime) startTime = timestamp;
                        const progress = Math.min((timestamp - startTime) / duration, 1);
                        const easedProgress = easeInOutQuart(progress);
                        const currentValue = Math.floor(easedProgress * target);

                        el.textContent = currentValue + suffix;

                        if (progress < 1) {
                            requestAnimationFrame(animateNumber);
                        } else {
                            el.textContent = target + suffix;
                        }
                    };
                    requestAnimationFrame(animateNumber);
                } else {
                    requestAnimationFrame(() => {
                        el.style.transition = 'transform 1.5s cubic-bezier(0.77, 0, 0.175, 1)';
                        el.style.transform = 'scale(1)';
                        setTimeout(() => {
                            el.style.transition = '';
                            el.style.transform = '';
                        }, 1500);
                    });
                }
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.1 });

    stats.forEach((stat) => {
        const text = stat.textContent.trim();
        const match = text.match(/^([\d,.]+)(.*)$/);

        if (match) {
            stat.dataset.isNumeric = 'true';
            stat.dataset.target = match[1].replace(/,/g, '');
            stat.dataset.suffix = match[2].trim();
            stat.textContent = '0' + stat.dataset.suffix;
        } else {
            stat.dataset.isNumeric = 'false';
            stat.style.transform = 'scale(0.85)';
            stat.style.display = 'inline-block';
        }
        statObserver.observe(stat);
    });
});