// The storefront's authorization matrix, against the stubbed server (port 3456).
//
// WHAT THIS SUITE IS FOR: proving that the only thing this application will
// open a session for is a customer, that one customer cannot reach another's
// data, and that no public write can raise a role or name its own price.
//
// It exercises the routes this process serves and no others. A fixture row
// whose role is not 'customer' is here on purpose - the roles table is real,
// and the storefront has to refuse such an account at its door. That is
// section 1.
const BASE = 'http://localhost:3456';
const control = require('./harness-control');
const PASSWORD = 'correct-horse-42';

let pass = 0, fail = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { pass++; console.log('  PASS  ' + name); }
    else { fail++; failures.push(name + '  << ' + detail); console.log('  FAIL  ' + name + '   << ' + detail); }
}

// A cookie jar per actor, so sessions do not bleed between them.
function jar() {
    const store = new Map();
    return {
        header: () => [...store.entries()].map(([k, v]) => k + '=' + v).join('; '),
        absorb: (res) => {
            const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
            raw.forEach(line => {
                const [pair] = line.split(';');
                const idx = pair.indexOf('=');
                store.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            });
        },
        clear: () => store.clear()
    };
}

async function req(cookies, method, path, body, extraHeaders) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
    const cookieHeader = cookies ? cookies.header() : '';
    if (cookieHeader) headers.Cookie = cookieHeader;

    const res = await fetch(BASE + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
    });
    if (cookies) cookies.absorb(res);

    let payload = null;
    const text = await res.text();
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: res.status, body: payload };
}

(async () => {
    const anon = jar(), custA = jar(), custB = jar(), other = jar();

    console.log('\n=== 1. CUSTOMER SIGN-IN REQUIRES A PASSWORD ===');

    // THE DOOR OPENS FOR CUSTOMERS AND FOR NOBODY ELSE, and it says nothing
    // about what it refused. An earlier version answered a non-customer
    // account with a flag naming the role, which turned a route anybody may
    // call into a way to ask "is this address privileged?" of an address
    // somebody had already guessed.
    let r = await req(other, 'POST', '/api/auth/login', { identifier: 'other-role@example.test', password: PASSWORD });
    check('an account that is not a customer is refused here', r.status === 403, JSON.stringify(r));
    check('...and the refusal does not name the role it refused',
        !JSON.stringify(r.body).toLowerCase().includes('admin'), JSON.stringify(r.body));
    r = await req(other, 'GET', '/api/orders/mine');
    check('...and that refusal started no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: 'wrong-password' });
    check('a wrong password is refused', r.status === 401 && r.body.field === 'password', JSON.stringify(r));
    r = await req(custA, 'GET', '/api/orders/mine');
    check('...and starts no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('customer signs in with an identifier and password',
        r.status === 200 && r.body.customer.role === 'customer', JSON.stringify(r).slice(0, 120));
    check('the password hash is never returned', !JSON.stringify(r.body).includes('password_hash'), JSON.stringify(r.body));
    r = await req(custB, 'POST', '/api/auth/login', { identifier: 'b@example.test', password: PASSWORD });
    check('second customer signs in', r.status === 200, JSON.stringify(r).slice(0, 80));

    const legacy = jar();
    r = await req(legacy, 'POST', '/api/auth/login', { identifier: 'c@example.test', password: PASSWORD });
    check('a legacy profile with no hash is locked, not treated as passwordless',
        r.status === 403 && r.body.field === 'password', JSON.stringify(r));
    r = await req(legacy, 'GET', '/api/orders/mine');
    check('...and that locked profile received no session', r.status === 401, JSON.stringify(r).slice(0, 80));

    console.log('\n=== 2. IDOR — one customer cannot read another\'s orders ===');
    const aOrders = await req(custA, 'GET', '/api/orders/mine');
    const bOrders = await req(custB, 'GET', '/api/orders/mine');
    check('customer A sees only their own order',
        aOrders.status === 200 && aOrders.body.length === 1 && aOrders.body[0].id === 900,
        JSON.stringify(aOrders.body).slice(0, 160));
    check('customer B sees only their own order',
        bOrders.status === 200 && bOrders.body.length === 1 && bOrders.body[0].id === 901,
        JSON.stringify(bOrders.body).slice(0, 160));
    check('A\'s payload contains nothing belonging to B',
        !JSON.stringify(aOrders.body).includes('2 B Street') && !JSON.stringify(aOrders.body).includes('TRK-B'),
        JSON.stringify(aOrders.body).slice(0, 200));

    console.log('\n=== 3. MASS ASSIGNMENT / ROLE ESCALATION ===');
    r = await req(custA, 'PATCH', '/api/auth/me', { name: 'Still A', role_id: 1, id: 100, email: 'other-role@example.test' });
    const after = await req(custA, 'GET', '/api/auth/me');
    check('PATCH /api/auth/me cannot set role_id',
        after.body.customer.role === 'customer', JSON.stringify(after.body.customer));
    check('PATCH /api/auth/me cannot change id or email',
        after.body.customer.id === 200 && after.body.customer.email === 'a@example.test',
        JSON.stringify(after.body.customer));
    r = await req(custA, 'GET', '/api/auth/me');
    check('still a customer after the attempt',
        r.body.customer && r.body.customer.role === 'customer', JSON.stringify(r.body.customer));

    r = await req(jar(), 'POST', '/api/auth/register',
        { name: 'No Secret', email: 'no-secret@example.test', phone: '9000000098' });
    check('register refuses to create a passwordless account',
        r.status === 400 && r.body.field === 'password', JSON.stringify(r));

    r = await req(anon, 'POST', '/api/auth/register',
        { name: 'Escalate', email: 'esc@example.test', phone: '9000000099', password: PASSWORD, role_id: 1 });
    check('register cannot self-assign another role',
        r.status === 201 && r.body.customer.role === 'customer', JSON.stringify(r.body).slice(0, 140));

    console.log('\n=== 4. GUEST CHECKOUT CANNOT ADOPT A NON-CUSTOMER ACCOUNT ===');
    const guest = jar();
    r = await req(guest, 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Attacker', email: 'other-role@example.test', phone: '9111111111', password: PASSWORD },
        address: { address_line: 'x', city: 'y', state: 'z', postal_code: '111111' }
    });
    check('checkout naming a non-customer email is refused', r.status === 409, r.status + ' ' + JSON.stringify(r.body).slice(0, 90));
    r = await req(guest, 'GET', '/api/auth/me');
    check('...and no session was created at all', r.status === 200 && r.body.customer === null, JSON.stringify(r).slice(0, 90));

    console.log('\n=== 5. CHECKOUT IS NOT A SECOND SIGN-IN DOOR ===');
    const guest2 = jar();
    r = await req(guest2, 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 1 }],
        contact: { name: 'Someone Else', email: 'a@example.test', phone: '9222222222', password: PASSWORD },
        address: { address_line: 'ATTACKER ADDRESS', city: 'Nowhere', state: 'NA', postal_code: '999999' }
    });
    check('an existing customer is told to sign in first', r.status === 409 && r.body.field === 'email',
        r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
    const guest2Profile = await req(guest2, 'GET', '/api/auth/me');
    check('...and checkout did not mint a session',
        guest2Profile.status === 200 && guest2Profile.body.customer === null,
        guest2Profile.status + ' ' + JSON.stringify(guest2Profile.body).slice(0, 120));
    const aProfile = await req(custA, 'GET', '/api/auth/me');
    check('customer A\'s saved address is untouched',
        aProfile.body.customer.address_line === '1 A Street',
        'is now: ' + aProfile.body.customer.address_line);

    console.log('\n=== 6. ORDER WRITES ARE ATOMIC ===');
    const beforeAtomic = await req(custA, 'GET', '/api/orders/mine');
    control.failNextAtomicCheckout();
    r = await req(jar(), 'POST', '/api/checkout', {
        items: [{ product_id: 1, quantity: 2 }],
        contact: { name: 'Atomic Test', email: 'atomic@example.test', phone: '9333333333', password: PASSWORD },
        address: { address_line: '3 Test Street', city: 'Rajkot', state: 'Gujarat', postal_code: '360001' },
        payment_mode: 'offline', payment_method: 'Cash on Delivery'
    });
    check('a database failure refuses the checkout', r.status === 500, JSON.stringify(r).slice(0, 120));
    const afterAtomic = await req(custA, 'GET', '/api/orders/mine');
    check('...and leaves no partial order behind',
        afterAtomic.status === 200 && afterAtomic.body.length === beforeAtomic.body.length,
        `${beforeAtomic.body.length} before, ${afterAtomic.body.length} after`);

    console.log('\n=== 7. PRICE IS SERVER-SIDE (client cannot name it) ===');
    r = await req(anon, 'POST', '/api/checkout/summary',
        { items: [{ product_id: 1, quantity: 1, price: 1, unit_price: 1, line_total: 1 }] });
    check('posted price is ignored; server prices from the catalogue',
        r.status === 200 && r.body.lines[0].unit_price === 1000,
        JSON.stringify(r.body.lines).slice(0, 140));
    r = await req(anon, 'POST', '/api/checkout/summary', { items: [{ product_id: 2, quantity: 1 }] });
    check('an "On request" product is blocked, not silently priced',
        r.status === 200 && r.body.blocked.length === 1 && r.body.blocked[0].reason === 'on_request',
        JSON.stringify(r.body).slice(0, 140));

    console.log('\n=== 8. INPUT BOUNDS ON ANONYMOUS WRITE ROUTES ===');
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'x'.repeat(5000), email: 'e@example.test', message: 'hi' });
    check('over-long name is refused', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'ok', email: 'not-an-email', message: 'hi' });
    check('malformed email is refused (was unchecked here)', r.status === 400, JSON.stringify(r).slice(0, 90));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'ok', email: 'e@example.test', message: 'hi' });
    check('a legitimate enquiry still submits', r.status === 200, JSON.stringify(r).slice(0, 90));

    r = await req(anon, 'POST', '/api/quote-requests', {
        business_name: 'Quantity Test', contact_name: 'Buyer', email: 'buyer@example.test',
        business_address: 'Rajkot, Gujarat',
        items: [{ category_name: 'Machinery', product_name: 'Fake Machine', product_id: 1, category_id: 10, quantity: 7 }]
    });
    check('a quote accepts an explicit line quantity', r.status === 200, JSON.stringify(r).slice(0, 100));

    console.log('\n=== 9. UNKNOWN IDENTIFIER IS FLAGGED, NOT JUST 404ed ===');
    r = await req(jar(), 'POST', '/api/auth/login', { identifier: 'nobody@example.test', password: PASSWORD });
    check('login for an unknown account answers 404 with account_not_found',
        r.status === 404 && r.body.account_not_found === true, JSON.stringify(r).slice(0, 120));
    check('...and does not start a session',
        !r.body.customer, JSON.stringify(r).slice(0, 90));

    console.log('\n=== 10. SIGN-OUT ACTUALLY ENDS THE SESSION ===');
    const bye = jar();
    r = await req(bye, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('signed in before signing out', r.status === 200, JSON.stringify(r).slice(0, 60));
    r = await req(bye, 'POST', '/api/auth/logout', {});
    check('logout returns 200', r.status === 200, JSON.stringify(r).slice(0, 60));
    r = await req(bye, 'GET', '/api/orders/mine');
    check('the order history is closed after logout', r.status === 401, r.status);
    r = await req(bye, 'GET', '/api/auth/me');
    check('...and the storefront reads nobody as signed in',
        r.status === 200 && r.body.customer === null, JSON.stringify(r).slice(0, 80));

    console.log('\n=== 11. SESSION FIXATION ===');
    const fix = jar();
    await req(fix, 'GET', '/api/auth/me');
    const before = fix.header();
    await req(fix, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('session id is regenerated on sign-in', fix.header() !== before || before === '',
        'before=' + before.slice(0, 30) + ' after=' + fix.header().slice(0, 30));

    console.log('\n=== 12. CROSS-ORIGIN ===');
    const cors = await fetch(BASE + '/api/auth/me', { headers: { Origin: 'https://evil.example' } });
    check('no ACAO for a foreign origin', !cors.headers.get('access-control-allow-origin'),
        String(cors.headers.get('access-control-allow-origin')));
    r = await req(anon, 'POST', '/api/submit-form',
        { form_type: 'enquiry', full_name: 'x', email: 'e@example.test', message: 'y' },
        { Origin: 'https://evil.example' });
    check('cross-origin state change is refused', r.status === 403, r.status + ' ' + JSON.stringify(r.body).slice(0, 60));

    console.log('\n=== 13. A CART BELONGS TO ONE ACCOUNT, AND TO NOBODY ELSE ===');

    // custA is customer 200 and has been signed in since section 4. custB is
    // customer 201, blocked and then unblocked in section 13 — a block refuses
    // a session, it does not destroy one, so that jar is a working customer
    // session again. Reusing both is not just tidiness: authLimiter allows 20
    // sign-in attempts per window and this suite already spends 17 of them.

    // A guest cart never reaches the server at all, so both doors are shut
    // rather than answering with an empty one.
    //
    // Use a fresh jar so this assertion cannot inherit any earlier session.
    const noSession = jar();
    r = await req(noSession, 'GET', '/api/cart');
    check('a guest cannot read a cart', r.status === 401, JSON.stringify(r).slice(0, 80));
    r = await req(noSession, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 1 }] });
    check('a guest cannot write one', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'PUT', '/api/cart', {
        items: [{ id: 1, name: 'Fake Machine', category_name: 'Machinery', price: '1000', image_url: '', quantity: 3 }]
    });
    check('A saves a cart',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    r = await req(custA, 'GET', '/api/cart');
    check('...and reads it back with the snapshot intact',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === '1' &&
        r.body.items[0].name === 'Fake Machine' && r.body.items[0].price === '1000',
        JSON.stringify(r).slice(0, 160));

    // The whole reason this moved off localStorage.
    r = await req(custB, 'GET', '/api/cart');
    check("B cannot see A's cart",
        r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 140));

    // "On request" is a legal price in this catalogue, which is why the
    // snapshot column is text. A numeric column would store null here and the
    // drawer would show a blank where the shelf shows a sentence.
    r = await req(custB, 'PUT', '/api/cart', {
        items: [{ id: 2, name: 'Fake On Request', category_name: 'Machinery', price: 'On request', image_url: '', quantity: 1 }]
    });
    check('B saves their own',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].price === 'On request',
        JSON.stringify(r).slice(0, 140));

    r = await req(custA, 'GET', '/api/cart');
    check("...without disturbing A's",
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].id === '1' && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Signing out hides a cart; it does not destroy one. That is the whole
    // difference between this and wiping localStorage on logout.
    await req(custA, 'POST', '/api/auth/logout', {});
    r = await req(custA, 'GET', '/api/cart');
    check('signed out, the cart is unreachable', r.status === 401, JSON.stringify(r).slice(0, 80));

    r = await req(custA, 'POST', '/api/auth/login', { identifier: 'a@example.test', password: PASSWORD });
    check('A signs back in', r.status === 200, JSON.stringify(r).slice(0, 80));
    r = await req(custA, 'GET', '/api/cart');
    check('...and the basket is exactly where they left it',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Bounds, and they are checkout's numbers on purpose: a cart that can hold
    // more than an order can carry is a trap sprung at the last screen.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 0 }] });
    check('a quantity of 0 is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 'not-a-product', quantity: 1 }] });
    check('an unparseable product id is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', { items: 'a cart, honestly' });
    check('a cart that is not a list is refused', r.status === 400, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'PUT', '/api/cart', {
        items: Array.from({ length: 51 }, (_, i) => ({ id: i + 1, quantity: 1 }))
    });
    check('51 lines is refused', r.status === 400, JSON.stringify(r).slice(0, 100));

    r = await req(custA, 'GET', '/api/cart');
    check('...and not one of those refusals half-applied',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 3,
        JSON.stringify(r).slice(0, 140));

    // Duplicates collapse and cap rather than failing the write: the unique
    // index makes two lines for one product unstorable, so meaning the
    // sensible thing beats a 400 nobody can act on.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, quantity: 60 }, { id: 1, quantity: 60 }] });
    check('duplicate lines collapse and cap at 99',
        r.status === 200 && r.body.items.length === 1 && r.body.items[0].quantity === 99,
        JSON.stringify(r).slice(0, 140));

    // Truncation, not refusal, for the snapshot columns — they are copies of
    // our own catalogue row, and failing a customer's cart over our data entry
    // would be the wrong trade.
    r = await req(custA, 'PUT', '/api/cart', { items: [{ id: 1, name: 'x'.repeat(5000), quantity: 1 }] });
    check('an over-long product name is truncated, not refused',
        r.status === 200 && r.body.items[0].name.length === 200, JSON.stringify(r).slice(0, 100));

    // Emptying is an ordinary write, and is what checkout does on success.
    r = await req(custA, 'PUT', '/api/cart', { items: [] });
    check('a cart can be emptied', r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 100));
    r = await req(custA, 'GET', '/api/cart');
    check('...and stays empty', r.status === 200 && r.body.items.length === 0, JSON.stringify(r).slice(0, 100));
    r = await req(custB, 'GET', '/api/cart');
    check("B's cart survived A emptying theirs",
        r.status === 200 && r.body.items.length === 1, JSON.stringify(r).slice(0, 140));

    console.log('\n' + '='.repeat(64));
    console.log(`RESULT: ${pass} passed, ${fail} failed`);
    if (failures.length) { console.log('\nFAILURES:'); failures.forEach(f => console.log('  - ' + f)); }
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
})();
