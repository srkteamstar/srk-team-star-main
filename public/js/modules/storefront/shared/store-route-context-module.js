(function () {
    'use strict';

    function waitFor(selector, timeout) {
        const started = Date.now();
        return new Promise(resolve => {
            const check = () => {
                const node = document.querySelector(selector);
                if (node) return resolve(node);
                if (Date.now() - started >= timeout) return resolve(null);
                window.setTimeout(check, 80);
            };
            check();
        });
    }

    async function applyRoute() {
        const params = new URLSearchParams(window.location.search);
        const productId = params.get('product');
        const categoryId = params.get('category');
        if (!productId && !categoryId) return;

        document.querySelector('button[data-policy="all-products"]')?.click();

        if (categoryId) {
            const button = await waitFor(`.category-btn[data-category="${CSS.escape(categoryId)}"]`, 8000);
            button?.click();
        }

        if (productId && window.productDetails) {
            await (window.productSection?.loadProducts?.() || Promise.resolve());
            window.productDetails.open(productId);
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyRoute);
    else applyRoute();
})();
