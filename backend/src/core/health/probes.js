/*
 * core/health/probes.js — liveness and readiness, kept apart on purpose
 * ============================================================================
 *
 * NEW IN `#2`. `#1` had no health endpoint at all, so the only way to ask
 * whether the process was up was to request a page and infer it, and the only
 * way to ask whether its database was reachable was to place an order.
 *
 * These are additive: no existing route, response or behaviour changes because
 * they exist. They are the one thing the doctrine asks for that `#1` did not
 * already have in some form.
 *
 * THE TWO MUST NEVER BE CONFLATED, and the reason is worth stating plainly
 * because getting it wrong turns a small outage into a total one:
 *
 *   /health/live   "is this process running and able to execute code?"
 *                  ZERO dependencies. It touches nothing but its own stack.
 *                  A failure here means an orchestrator should KILL and
 *                  restart the container. Putting a database check in here is
 *                  the classic error: a five-second Supabase latency spike
 *                  would fail every instance at once, every instance would be
 *                  restarted, and the restarts would then be the outage.
 *
 *   /health/ready  "can this process safely take traffic right now?"
 *                  Checks the dependency it genuinely cannot serve without —
 *                  the database — and answers 503 when it cannot. An
 *                  orchestrator takes the instance OUT OF ROTATION and leaves
 *                  it alive; it starts serving again by itself the moment the
 *                  dependency returns. Nothing is restarted, so nothing is
 *                  lost.
 *
 * WHAT READINESS ACTUALLY ASKS. The cheapest query that proves the credential
 * works and the schema is reachable, which is a bounded read of `roles` — two
 * rows, no customer data in it, and the same table core/security/guards.js
 * already caches per process. A probe that reads a table full of PII would
 * make an unauthenticated endpoint into a disclosure the day somebody logs the
 * response.
 *
 * NEITHER IS RATE LIMITED, deliberately. An orchestrator polls liveness every
 * few seconds by design, and a 429 to a liveness probe reads as a dead process
 * and gets the container killed. They are cheap, they take no input, and they
 * return no information an attacker does not get from the fact the site
 * answers at all.
 */
const express = require('express');
const { supabase } = require('../database/supabase');

/** How long readiness will wait on the database before calling it unreachable. */
const READY_TIMEOUT_MS = 3000;

const startedAt = Date.now();

function livenessHandler(req, res) {
    // No await, no dependency, no branch that can throw. If this code runs at
    // all, the answer is yes.
    res.status(200).json({
        status: 'live',
        uptime_seconds: Math.floor((Date.now() - startedAt) / 1000)
    });
}

async function readinessHandler(req, res) {
    // Cache-Control matters here in a way it does not on a page: a proxy that
    // cached a readiness answer would report a database that came back as
    // still down, or one that has since failed as still fine.
    res.setHeader('Cache-Control', 'no-store');

    let timer;
    try {
        const query = supabase.from('roles').select('id').limit(1);

        // A hung socket is not a healthy dependency, and without this the
        // probe would hang with it — which an orchestrator reads as a timeout
        // anyway, just later and with no message saying which check stalled.
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('database check timed out')), READY_TIMEOUT_MS);
        });

        const { error } = await Promise.race([query, timeout]);
        if (error) throw error;

        res.status(200).json({ status: 'ready', checks: { database: 'ok' } });
    } catch (error) {
        // The message, not the stack, and nothing about credentials. 503 is
        // the load balancer's signal; the body is for whoever reads the logs.
        res.status(503).json({
            status: 'not_ready',
            checks: { database: 'unreachable' },
            detail: error && error.message ? String(error.message).slice(0, 200) : 'unknown'
        });
    } finally {
        clearTimeout(timer);
    }
}

/** @returns {import('express').Router} */
function healthRouter() {
    const router = express.Router();
    router.get('/live', livenessHandler);
    router.get('/ready', readinessHandler);
    return router;
}

module.exports = { healthRouter, livenessHandler, readinessHandler };
