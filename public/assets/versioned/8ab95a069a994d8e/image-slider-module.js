/**
 * ---------------------------------------------------------
 * 1. CAROUSEL DATA SOURCE
 * ---------------------------------------------------------
 * Pulls published entries from the `upcoming_projects` table via the
 * public, read-only endpoint (no credentials needed). category ->
 * small label above the heading, title -> the large heading text.
 */
async function fetchUpcomingProjectsData() {
    try {
        const response = await fetch('/api/projects/public', { cache: 'no-store' });
        if (!response.ok) throw new Error('Failed to fetch upcoming projects');

        const { section_visible, projects } = await response.json();

        return {
            sectionVisible: section_visible,
            items: projects.map(p => ({
                title: p.category || '',
                image: p.image_url,
                heading: p.title || '',
                description: p.description || '',
                ctaText: 'Explore Project',
                // No per-project page exists, so this hands off to the
                // catalogue rather than dead-ending on a /products route that
                // was never built. Same fallback as the `|| '/catalogue.html'`
                // below, which covers a row that somehow arrives without one.
                ctaLink: '/catalogue.html'
            }))
        };
    } catch (error) {
        console.error('Error fetching upcoming projects:', error);
        return { sectionVisible: false, items: [] };
    }
}

/**
 * ---------------------------------------------------------
 * 2. CORE CAROUSEL LOGIC
 * ---------------------------------------------------------
 * Handles layout, animation, and DOM updates for a single carousel instance.
 */
class HorizontalCarousel {
    constructor(wrapperElement, items) {
        // Scope everything to this specific carousel's wrapper
        this.wrapper = wrapperElement;
        
        // Find elements ONLY inside this specific wrapper using classes
        this.container = this.wrapper.querySelector('.horizontal-carousel');
        this.leftBtn = this.wrapper.querySelector('.carousel-left-btn');
        this.rightBtn = this.wrapper.querySelector('.carousel-right-btn');
        
        this.categoryTitle = this.wrapper.querySelector('.category-title');
        this.categoryHeading = this.wrapper.querySelector('.category-heading');
        this.categoryDescription = this.wrapper.querySelector('.category-description');
        this.categoryCta = this.wrapper.querySelector('.category-cta');
        this.ctaActionBar = this.wrapper.querySelector('.cta-action-bar');

        this.items = items;
        this.currentIndex = 0;
        
        this.animationTimeouts = [];
        this.animationIntervals = [];

        this.init();
    }

    init() {
        this.render();
        this.updateLayout();
        this.addEventListeners();
    }

    clearAnimations() {
        this.animationTimeouts.forEach(clearTimeout);
        this.animationIntervals.forEach(clearInterval);
        this.animationTimeouts = [];
        this.animationIntervals = [];
    }

    render() {
        this.container.innerHTML = '';
        this.items.forEach((item, index) => {
            const card = document.createElement('div');
            card.dataset.index = index;
            card.className = `absolute w-full h-full rounded-2xl overflow-hidden shadow-xl transition-all duration-500 ease-out cursor-pointer select-none border border-black/5 bg-white`;
            card.innerHTML = `<img src="${item.image}" alt="${item.title}" loading="lazy" decoding="async" fetchpriority="low" class="w-full h-full object-cover pointer-events-none" />`;
            this.container.appendChild(card);
        });
    }

    updateTextContent() {
        const currentData = this.items[this.currentIndex];
        if (!currentData) return;

        this.clearAnimations();
        let currentDelay = 0;

        // 1. Scrambled Text Animation for Category Title
        if (this.categoryTitle) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
            const originalText = currentData.title.split('');
            let iterations = 0;
            this.categoryTitle.textContent = currentData.title;

            const interval = setInterval(() => {
                this.categoryTitle.textContent = originalText.map((char, index) => {
                    if (index < iterations) return char;
                    if (char === ' ') return ' ';
                    return chars[Math.floor(Math.random() * chars.length)];
                }).join('');

                if (iterations >= originalText.length) clearInterval(interval);
                iterations += 0.35;
            }, 35);
            this.animationIntervals.push(interval);
            currentDelay = 350;
        }

        // 2. Word-by-word reveal for the Heading
        if (this.categoryHeading) {
            this.categoryHeading.innerHTML = '';
            const words = currentData.heading.split(/(\s+)/);
            const charsArray = [];

            words.forEach(word => {
                if (word.trim() === '') {
                    const spaceSpan = document.createElement('span');
                    spaceSpan.className = 'inline-block whitespace-pre';
                    spaceSpan.textContent = word;
                    this.categoryHeading.appendChild(spaceSpan);
                    return;
                }
                const wordSpan = document.createElement('span');
                wordSpan.className = 'inline-block whitespace-nowrap';
                word.split('').forEach(char => {
                    const charSpan = document.createElement('span');
                    charSpan.textContent = char;
                    charSpan.className = 'inline-block opacity-0 translate-y-[10px] transition-all duration-500 ease-out';
                    wordSpan.appendChild(charSpan);
                    charsArray.push(charSpan);
                });
                this.categoryHeading.appendChild(wordSpan);
            });

            charsArray.forEach((span, index) => {
                const timeout = setTimeout(() => {
                    span.classList.remove('opacity-0', 'translate-y-[10px]');
                }, currentDelay + (index * 15));
                this.animationTimeouts.push(timeout);
            });
            currentDelay += (charsArray.length * 15);
        }

        // 3. Instant Hide for Description and CTA
        if (this.categoryDescription) {
            this.categoryDescription.classList.remove('transition-all', 'duration-700', 'ease-out');
            this.categoryDescription.classList.add('opacity-0', 'translate-y-4');
            this.categoryDescription.textContent = currentData.description;
        }

        if (this.categoryCta) {
            this.categoryCta.textContent = currentData.ctaText;
            this.categoryCta.href = currentData.ctaLink || '/catalogue.html';
        }

        if (this.ctaActionBar) {
            this.ctaActionBar.classList.remove('transition-all', 'duration-700', 'ease-out');
            this.ctaActionBar.classList.add('opacity-0', 'translate-y-4');
        }

        // Force a synchronous DOM reflow
        void this.container.offsetWidth; 

        // 4. Smooth Reveal for Description and CTA
        const cascadeTimeout = setTimeout(() => {
            if (this.categoryDescription) {
                this.categoryDescription.classList.add('transition-all', 'duration-700', 'ease-out');
                this.categoryDescription.classList.remove('opacity-0', 'translate-y-4');
            }
            if (this.ctaActionBar) {
                this.ctaActionBar.classList.add('transition-all', 'duration-700', 'ease-out');
                this.ctaActionBar.classList.remove('opacity-0', 'translate-y-4');
            }
        }, currentDelay + 150);

        this.animationTimeouts.push(cascadeTimeout);
    }

    updateLayout() {
        const cards = Array.from(this.container.children);
        const total = this.items.length;

        cards.forEach((card, index) => {
            let offset = index - this.currentIndex;
            if (offset > Math.floor(total / 2)) offset -= total;
            if (offset < -Math.floor(total / 2)) offset += total;

            const absOffset = Math.abs(offset);
            const translateX = offset * 60;
            const scale = 1 - absOffset * 0.12;
            const opacity = absOffset > 2 ? 0 : 1 - absOffset * 0.6;
            const zIndex = 10 - absOffset;
            const rotateY = offset * -10;

            card.style.transform = `translateX(${translateX}px) scale(${scale}) rotateY(${rotateY}deg)`;
            card.style.opacity = opacity;
            card.style.zIndex = zIndex;
            card.style.pointerEvents = offset === 0 ? 'auto' : 'none';
        });

        this.updateTextContent();
    }

    next() {
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this.updateLayout();
    }

    prev() {
        this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
        this.updateLayout();
    }

    addEventListeners() {
        if (this.leftBtn) this.leftBtn.addEventListener('click', () => this.prev());
        if (this.rightBtn) this.rightBtn.addEventListener('click', () => this.next());
        
        this.container.addEventListener('click', () => this.next());
        this.wrapper.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') this.prev();
            if (e.key === 'ArrowRight') this.next();
        });
    }
}

/**
 * ---------------------------------------------------------
 * 3. INITIALIZATION CONTROLLER
 * ---------------------------------------------------------
 * Automatically detects carousels on the page and initializes them.
 */
document.addEventListener('DOMContentLoaded', async () => {
    // Find all blocks with the 'carousel-section' class
    const carouselSections = document.querySelectorAll('.carousel-section');
    if (carouselSections.length === 0) return;

    const { sectionVisible, items } = await fetchUpcomingProjectsData();
    const hasContent = sectionVisible && items.length > 0;

    carouselSections.forEach(section => {
        // Hide the surrounding section (heading + copy) too, not just the carousel
        const sectionRoot = section.closest('.upcoming-projects') || section;

        if (!hasContent) {
            sectionRoot.classList.add('hidden');
            return;
        }

        sectionRoot.classList.remove('hidden');
        new HorizontalCarousel(section, items);
    });
});
