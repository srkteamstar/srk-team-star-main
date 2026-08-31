const { spawn } = require('child_process');
const path = require('path');

module.exports = async function globalSetup() {
    const server = spawn(process.execPath, [path.join(__dirname, '..', 'authz-harness.js')], {
        env: Object.assign({}, process.env, { HARNESS_PORT: '3457', SITE_ORIGIN: 'https://storefront.example.test' }),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const output = [];
    server.stdout.on('data', chunk => output.push(String(chunk)));
    server.stderr.on('data', chunk => output.push(String(chunk)));

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error('Browser harness exited during startup:\n' + output.join(''));
        }
        try {
            const response = await fetch('http://127.0.0.1:3457/');
            if (response.ok) {
                return async () => {
                    if (!server.killed) server.kill();
                };
            }
        } catch (error) {}
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (!server.killed) server.kill();
    throw new Error('Browser harness did not start in 20 seconds:\n' + output.join(''));
};
