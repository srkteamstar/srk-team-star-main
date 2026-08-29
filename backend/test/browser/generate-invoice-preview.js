const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { chromium } = require('@playwright/test');

const BACKEND = path.join(__dirname, '..', '..');
const ROOT = path.join(BACKEND, '..');
const PORT = '3458';
const OUTPUT = process.env.INVOICE_PREVIEW_OUTPUT ||
    path.join(ROOT, 'output', 'pdf', 'srk-purchase-invoice-preview.pdf');

async function main() {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

    const server = spawn(process.execPath, [path.join(BACKEND, 'test', 'authz-harness.js')], {
        cwd: BACKEND,
        env: Object.assign({}, process.env, { HARNESS_PORT: PORT }),
        stdio: ['ignore', 'pipe', 'inherit']
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Preview server did not start.')), 15000);
        server.stdout.on('data', chunk => {
            if (!String(chunk).includes('Server running')) return;
            clearTimeout(timer);
            resolve();
        });
        server.once('exit', code => reject(new Error('Preview server exited with ' + code)));
    });

    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await page.goto(`http://127.0.0.1:${PORT}/store/store.html`, { waitUntil: 'networkidle' });
        await page.evaluate(async () => {
            await window.customerSession.signIn({
                identifier: 'a@example.test', password: 'correct-horse-42'
            });
            window.orderInvoice.open(900);
        });
        await page.locator('.purchase-invoice').waitFor({ state: 'visible', timeout: 15000 });
        if (process.env.LONG_INVOICE_PREVIEW) {
            await page.locator('.invoice-table tbody').evaluate(body => {
                const row = body.querySelector('tr');
                for (let index = 2; index <= 55; index += 1) {
                    const copy = row.cloneNode(true);
                    copy.children[0].textContent = String(index);
                    body.appendChild(copy);
                }
            });
            const dimensions = await page.evaluate(() => ({
                invoice: document.querySelector('.purchase-invoice').scrollHeight,
                scroll: document.querySelector('#order-invoice-overlay-scroll').scrollHeight,
                body: document.body.scrollHeight,
                rows: document.querySelectorAll('.invoice-table tbody tr').length
            }));
            process.stdout.write(JSON.stringify(dimensions) + '\n');
        }
        await page.emulateMedia({ media: 'print' });
        await page.pdf({
            path: OUTPUT,
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true
        });
    } finally {
        await browser.close();
        server.kill();
    }

    process.stdout.write(OUTPUT + '\n');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
