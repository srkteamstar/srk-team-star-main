#!/usr/bin/env node
// =============================================================================
// reconcile-scheduled.js — reconcile.js, run unattended and left in writing
// =============================================================================
//
//   node scripts/reconcile-scheduled.js              # yesterday and today
//   node scripts/reconcile-scheduled.js --days=7     # a wider window
//
// Install it with scripts/schedule-reconcile.ps1 (Windows Task Scheduler), or
// from cron:
//
//   30 2 * * *  cd /srv/srk/backend && /usr/bin/node scripts/reconcile-scheduled.js --days=2 || true
//
// WHY A WRAPPER AND NOT JUST THE CRON LINE
// ---------------------------------------------------------------------------
// reconcile.js is written to be READ. It prints a report to a terminal and
// exits 2 when the two ledgers disagree, which is exactly right when a person
// is standing there. Nobody is standing here, and three things follow.
//
//   IT HAS TO LEAVE A RECORD. A scheduled run that prints to a console nobody
//   attaches to has not reconciled anything — it has only proved the machine
//   was awake. The report is written to backend/logs/reconcile-YYYY-MM.log,
//   one file per month, appended, with the exit status on the end of every
//   run. That file is the answer to "when did this last agree?", which is the
//   question actually asked after a customer says they paid.
//
//   IT MUST NOT OVERLAP ITSELF. A wide --days window against a slow gateway
//   can outlast its own interval, and two of these running at once means two
//   sets of API calls racing to describe the same window. A lock file holds
//   the slot; a run that finds it held exits 0 and says so, because a skipped
//   run is not a discrepancy and must not page anybody.
//
//   IT MUST NOT INVENT AN ALARM. The exit code is passed through untouched:
//   0 reconciled, 2 discrepancies, 1 the check itself failed. A cron rule that
//   mails on failure then means what it says. Note the difference between 1
//   and 2 — a 1 is "we do not know", which is not "everything is fine".
//
// STILL READ ONLY. Nothing here writes to the database, for the reason
// reconcile.js states at length: a reconciliation tool that repairs rows is
// one that can quietly mark things paid. This wrapper adds a log file and a
// lock file and no authority whatsoever.
// =============================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const LOG_DIR = path.join(BACKEND, 'logs');
const LOCK_FILE = path.join(LOG_DIR, 'reconcile.lock');

// A run that is merely slow must not be mistaken for a crashed one forever.
const LOCK_STALE_MS = 60 * 60 * 1000;

const args = process.argv.slice(2);

// Two days by default, not one. A payment captured at 23:58 and a sweep that
// runs at 02:30 are on opposite sides of a one-day window, so the narrow
// version would skip precisely the payments most likely to have lost their
// callback. Overlapping windows re-check the same payments harmlessly — this
// reads and compares, it does not act.
if (!args.some(arg => arg.startsWith('--days='))) args.push('--days=2');

function stamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function acquireLock() {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (error) {
        // Nowhere to write. Say so on stderr and reconcile anyway — the check
        // matters more than the record of it.
        process.stderr.write(`reconcile-scheduled: cannot create ${LOG_DIR}: ${error.message}\n`);
        return null;
    }

    try {
        const held = fs.statSync(LOCK_FILE);
        if (Date.now() - held.mtimeMs < LOCK_STALE_MS) return false;
        // Older than the stale window: the process that wrote it is gone.
        fs.unlinkSync(LOCK_FILE);
    } catch (error) {
        if (error.code !== 'ENOENT') return false;
    }

    try {
        fs.writeFileSync(LOCK_FILE, `${process.pid} ${os.hostname()} ${stamp()}\n`, { flag: 'wx' });
        return true;
    } catch (error) {
        // 'wx' failed: another run took the slot between the check and here.
        return false;
    }
}

function releaseLock(held) {
    if (!held) return;
    try { fs.unlinkSync(LOCK_FILE); } catch (error) {}
}

function logPath() {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return path.join(LOG_DIR, `reconcile-${month}.log`);
}

function main() {
    const held = acquireLock();

    if (held === false) {
        process.stdout.write(`reconcile-scheduled: a run is already in progress (${LOCK_FILE}); skipping.\n`);
        process.exit(0);
    }

    let log = null;
    try {
        log = fs.createWriteStream(logPath(), { flags: 'a' });
    } catch (error) {
        process.stderr.write(`reconcile-scheduled: cannot open the log: ${error.message}\n`);
    }

    const write = (text) => {
        process.stdout.write(text);
        if (log) log.write(text);
    };

    write(`\n${'='.repeat(72)}\n  RECONCILE  ${stamp()}  ${args.join(' ')}\n${'='.repeat(72)}\n`);

    const child = spawn(process.execPath, [path.join(__dirname, 'reconcile.js'), ...args], {
        cwd: BACKEND,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', chunk => write(chunk.toString()));
    child.stderr.on('data', chunk => write(chunk.toString()));

    child.on('error', (error) => {
        write(`\n  FAILED TO START: ${error.message}\n`);
        releaseLock(held);
        if (log) log.end();
        process.exit(1);
    });

    child.on('close', (code) => {
        const verdict = code === 0 ? 'RECONCILED'
            : code === 2 ? 'DISCREPANCIES — read the MONEY MOVED block above'
            : `CHECK FAILED (exit ${code}) — this is not a clean result`;

        write(`  ${stamp()}  ${verdict}\n`);

        releaseLock(held);
        if (log) log.end();

        // Passed through untouched, so a mail-on-failure rule keeps meaning
        // what reconcile.js meant by it.
        process.exit(code === null ? 1 : code);
    });
}

main();
