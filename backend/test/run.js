// Boots the stubbed server, runs the authorization matrix against it, exits
// with the suite's status. `npm test` from backend/.
const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.HARNESS_PORT || '3456';

const server = spawn(process.execPath, [path.join(__dirname, 'authz-harness.js')], {
    env: Object.assign({}, process.env, { HARNESS_PORT: PORT }),
    stdio: ['ignore', 'pipe', 'inherit']
});

// All suites run against the one booted server, in order. A failure in any
// fails the run — `npm test` is a gate, not a report. invoice-rounding.test.js
// needs neither the server nor the database (buildOrderInvoice() is a pure
// function) but is listed here too so `npm test` remains the one command that
// runs everything.
const SUITES = ['authz.test.js', 'payments.test.js', 'invoice-rounding.test.js'];

function runSuites(index, worstCode) {
    if (index >= SUITES.length) {
        server.kill();
        process.exit(worstCode);
        return;
    }

    const tests = spawn(process.execPath, [path.join(__dirname, SUITES[index])], { stdio: 'inherit' });
    tests.on('exit', code => {
        const status = code === null ? 1 : code;
        runSuites(index + 1, status || worstCode);
    });
}

let booted = false;
server.stdout.on('data', chunk => {
    process.stdout.write(chunk);
    if (!booted && String(chunk).includes('Server running')) {
        booted = true;
        runSuites(0, 0);
    }
});

setTimeout(() => {
    if (!booted) { console.error('Harness did not start in 20s.'); server.kill(); process.exit(1); }
}, 20000);
