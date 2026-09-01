const { test, expect } = require('@playwright/test');

const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
function ratio(foreground, background) {
    const luminance = colour => rgb(colour).map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

for (const width of [320, 768, 1280]) {
    test(`Offer cards use theme corners and readable actions at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');
        const cards = page.locator('.what-we-offer-content > .container-card');
        await expect(cards).toHaveCount(3);
        const destinations = ['/catalogue.html#machinery', '/catalogue.html#moulding', '/catalogue.html#hardware'];
        for (let i = 0; i < 3; i++) {
            // Clear the preceding action's keyboard focus before checking the
            // next card's resting state (Tab correctly focuses the next link).
            await page.getByRole('heading', { name: 'Everything you need. Built for frame making.' }).click();
            const card = cards.nth(i), action = card.locator('a.cta');
            await expect(card).toHaveCSS('border-radius', '14px');
            await expect(card).toHaveCSS('overflow', 'hidden');
            await expect(action).toHaveAttribute('href', destinations[i]);
            await expect(action).toHaveCSS('border-radius', '0px');
            await expect(action).toHaveCSS('font-size', '16px');
            await expect(action).toHaveCSS('text-transform', 'none');
            await expect(action).toHaveCSS('color', 'rgb(228, 197, 92)');
            const rest = await action.evaluate(el => ({ text: getComputedStyle(el.querySelector('span')).color, icon: getComputedStyle(el.querySelector('svg')).color, background: getComputedStyle(el).backgroundColor }));
            expect(ratio(rest.text, rest.background)).toBeGreaterThanOrEqual(7);
            expect(rest.icon).toBe(rest.text);
            expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(56);
            await action.hover();
            await expect(action).toHaveCSS('background-color', 'rgb(228, 197, 92)');
            await expect(action).toHaveCSS('color', 'rgb(18, 23, 15)');
            await expect(action.locator('svg')).toHaveCSS('color', 'rgb(18, 23, 15)');
            await action.focus();
            await expect(action).toBeFocused();
            expect(await action.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
            await page.mouse.move(0, 0);
            await page.keyboard.press('Tab');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
}
