// ==========================================
// 3. HERO TEXT ANIMATION MODULE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const heading = document.getElementById('hero-heading');
    const subtext = document.getElementById('hero-subtext');
    const ctas = document.getElementById('hero-ctas');
    
    if (!heading || !subtext || !ctas) return;

    const text = heading.textContent.trim();
    const words = text.split(/\s+/);
    heading.innerHTML = '';
    heading.classList.remove('opacity-0');
    const charsArray = [];

    words.forEach((word, wordIndex) => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'inline-block whitespace-nowrap';
        word.split('').forEach(char => {
            const charSpan = document.createElement('span');
            charSpan.textContent = char;
            charSpan.className = 'inline-block opacity-0 translate-y-[10px] transition-all duration-700 ease-out';
            wordSpan.appendChild(charSpan);
            charsArray.push(charSpan);
        });
        heading.appendChild(wordSpan);
        if (wordIndex < words.length - 1) {
            heading.appendChild(document.createTextNode(' '));
        }
    });

    requestAnimationFrame(() => {
        charsArray.forEach((span, index) => {
            setTimeout(() => {
                span.classList.remove('opacity-0', 'translate-y-[10px]');
            }, index * 15 + 100);
        });

        const headingDuration = charsArray.length * 15;
        setTimeout(() => {
            subtext.classList.remove('opacity-0', 'translate-y-6');
        }, headingDuration + 150);

        setTimeout(() => {
            ctas.classList.remove('opacity-0', 'translate-y-6');
        }, headingDuration + 300);
    });
});