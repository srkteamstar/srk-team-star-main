const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './test/browser',
    globalSetup: './test/browser/global-setup.js',
    timeout: 45_000,
    expect: { timeout: 8_000 },
    workers: 1,
    use: {
        baseURL: 'http://127.0.0.1:3457',
        browserName: 'chromium',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    }
});
