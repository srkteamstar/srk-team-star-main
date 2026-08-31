/*
 * account-session.spec.js — S02, against the real overlay and the real
 * customer-session-module.js
 * ============================================================================
 *
 * customer-session-module.js and profile-icon-loader.js are browser globals;
 * nothing in authz.test.js or payments.test.js (Node, no DOM) can exercise
 * them. This is the one suite that can, because it runs a real Chromium
 * against the same fixture harness (authz-harness.js, port 3457) those API
 * suites use — a@example.test / correct-horse-42 is a working account here
 * too.
 *
 * WHAT THIS PROVES: a server failure on POST /api/auth/logout must not paint
 * "Signed out". Before the fix, customer-session-module.js's signOut()
 * cleared the cached profile unconditionally, and profile-icon-loader.js's
 * onSignOut() painted the confirmation screen without even looking at the
 * result — a synthetic 503 still ended with the overlay claiming the account
 * was closed while the server's httpOnly session was untouched. This
 * intercepts exactly that one request to force the failure, then proves two
 * things: the UI stays on the account view with a visible failure banner
 * instead of claiming success, and the server-side session is still alive
 * (GET /api/auth/me still returns the account) — the thing the old banner
 * would have been lying about. A second attempt, this time unintercepted,
 * confirms sign-out still works when the server actually agrees to it.
 */
const { test, expect } = require('@playwright/test');

const IDENTIFIER = 'a@example.test';
const PASSWORD = 'correct-horse-42';

async function signIn(page) {
    await page.goto('/store/store.html', { waitUntil: 'domcontentloaded' });
    await page.click('#profile-button');
    await page.fill('#account-identifier', IDENTIFIER);
    await page.fill('#account-password', PASSWORD);
    await page.click('#account-submit');

    // The account view — not the onboarding step — is reached directly:
    // a@example.test carries a saved name, phone and address already (see
    // authz-harness.js's fixture), so needsOnboarding() is false.
    await expect(page.locator('#account-signout')).toBeVisible();
}

test('a failed sign-out is shown as failed, not as signed out', async ({ page }) => {
    await signIn(page);

    // Force exactly one server failure on the logout call, the same shape a
    // real outage or a dropped connection would produce.
    await page.route('**/api/auth/logout', (route) => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service unavailable.' })
    }));

    await page.click('#account-signout');

    // Never the confirmation screen for a sign-out the server refused.
    await expect(page.getByRole('heading', { name: 'Signed out' })).toHaveCount(0);

    // The account view stays up, with a visible, non-empty failure banner —
    // not a silent no-op and not the false "Signed out" the bug produced.
    const banner = page.locator('#account-form-error');
    await expect(banner).toBeVisible();
    await expect(banner).not.toHaveText('');
    await expect(page.locator('#account-signout')).toBeVisible();

    // The proof that matters: the server-side session the banner is careful
    // not to claim is gone really is still alive.
    const stillSignedIn = await page.evaluate(async () => {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const body = await response.json();
        return Boolean(body && body.customer);
    });
    expect(stillSignedIn, 'the httpOnly session must still be open after a refused logout').toBe(true);

    // A real logout — no interception this time — still works.
    await page.unroute('**/api/auth/logout');
    await page.click('#account-signout');
    await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible();

    const signedOutOnServer = await page.evaluate(async () => {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const body = await response.json();
        return body && body.customer === null;
    });
    expect(signedOutOnServer, 'a confirmed sign-out must actually end the server session').toBe(true);
});
