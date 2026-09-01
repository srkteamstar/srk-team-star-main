// =============================================================================
// authz-harness.js — Phase 6 authorization matrix, against a stub database
// =============================================================================
//
// server.js is loaded for real — every route, every middleware, the actual
// requireCustomer, the actual login route. Only @supabase/supabase-js is
// replaced, with an in-memory fake holding a handful of obviously-fictional
// rows.
//
// That is the point: the live Supabase project must not be written to, and a
// read-only probe cannot exercise the paths that matter most — a guest
// checkout that names somebody else's email, a cart written and read back, an
// order cancelled while the gateway says money landed. Those need writes, so
// they get a fake database instead of a real one.
// =============================================================================

const path = require('path');
const Module = require('module');
const crypto = require('crypto');
const control = require('./harness-control');

// ---- The stub dataset -------------------------------------------------------
// Customer credentials use the same scrypt$salt$hash format as the real auth
// service. A fixed salt is appropriate only for deterministic fake rows; the
// application itself generates a fresh random salt for every password.
const FIXTURE_PASSWORD = 'correct-horse-42';
const fixtureSalt = Buffer.from('0123456789abcdef');
const fixturePasswordHash = (password) =>
    `scrypt$${fixtureSalt.toString('hex')}$${crypto.scryptSync(password, fixtureSalt, 64).toString('hex')}`;

// The one row whose role is NOT 'customer' is here for a single purpose:
// the storefront door has to refuse it, and a suite with no such row could
// only ever prove that customers get in.

const db = {
    roles: [
        { id: 1, role_name: 'admin' },
        { id: 2, role_name: 'customer' }
    ],
    user_profiles: [
        // role_id 1 is not the customer role. This account exists so the
        // storefront can be seen refusing it — at the login door, and again
        // when a guest checkout types its email into a contact form.
        { id: 100, full_name: 'Fake Other Role', email: 'other-role@example.test', phone_number: '9000000001',
          phone_normalized: '9000000001', company: null, role_id: 1, password_hash: fixturePasswordHash(FIXTURE_PASSWORD), created_at: '2026-01-01T00:00:00Z' },
        { id: 200, full_name: 'Fake Customer A', email: 'a@example.test', phone_number: '9000000002',
          phone_normalized: '9000000002', company: 'A Ltd', role_id: 2, password_hash: fixturePasswordHash(FIXTURE_PASSWORD), created_at: '2026-01-02T00:00:00Z' },
        { id: 201, full_name: 'Fake Customer B', email: 'b@example.test', phone_number: '9000000003',
          phone_normalized: '9000000003', company: 'B Ltd', role_id: 2, password_hash: fixturePasswordHash(FIXTURE_PASSWORD), created_at: '2026-01-03T00:00:00Z' },
        // No orders and no address, so a route that has to distinguish "an
        // account with nothing filed against it" from one with history has a
        // row of each to work with. It also represents a profile created during
        // identifier-only access: no hash means locked, never passwordless.
        { id: 202, full_name: 'Fake Customer C', email: 'c@example.test', phone_number: '9000000005',
          phone_normalized: '9000000005', company: null, role_id: 2, created_at: '2026-01-04T00:00:00Z' },
        { id: 203, full_name: 'Fake Unassigned Role', email: 'unassigned@example.test', phone_number: '9000000006',
          phone_normalized: '9000000006', company: null, role_id: null, password_hash: fixturePasswordHash(FIXTURE_PASSWORD), created_at: '2026-01-05T00:00:00Z' }
    ],
    shipping_addresses: [
        { id: 1, user_id: 200, full_address: '1 A Street', city: 'Gohana', state: 'Haryana', country: 'India', zip_code: '131301' },
        { id: 2, user_id: 201, full_address: '2 B Street', city: 'Sonipat', state: 'Haryana', country: 'India', zip_code: '131001' }
    ],
    orders: [
        { id: 900, order_number: 900, user_id: 200, status: 'Processing', tracking: null,
          amount: 1000, shipping_amount: 0, tax_amount: 180, net_amount: 1180, created_at: '2026-02-01T00:00:00Z',
          invoice_number: 'INV-20260201-000900', invoice_issued_at: '2026-02-01T00:00:00Z',
          currency: 'INR', tax_rate: 0.18, tax_type: 'CGST_SGST', place_of_supply: 'Haryana',
          buyer_name: 'Fake Customer A', buyer_company: 'A Ltd', buyer_email: 'a@example.test', buyer_phone: '9000000002',
          seller_legal_name: 'Pooja Rani', seller_trade_name: 'SRK Team Star', seller_gstin: '06DOCPR1264G1Z0',
          seller_address: 'Behind New ITI, Gohana, Haryana 131301, India', seller_email: 'srkteamstar@gmail.com',
          seller_phone: '+91 90500 09442', seller_state: 'Haryana' },
        { id: 901, order_number: 901, user_id: 201, status: 'Shipped', tracking: 'TRK-B',
          amount: 2000, shipping_amount: 0, tax_amount: 360, net_amount: 2360, created_at: '2026-02-02T00:00:00Z',
          invoice_number: 'INV-20260202-000901', invoice_issued_at: '2026-02-02T00:00:00Z',
          currency: 'INR', tax_rate: 0.18, tax_type: 'CGST_SGST', place_of_supply: 'Haryana',
          buyer_name: 'Fake Customer B', buyer_company: 'B Ltd', buyer_email: 'b@example.test', buyer_phone: '9000000003',
          seller_legal_name: 'Pooja Rani', seller_trade_name: 'SRK Team Star', seller_gstin: '06DOCPR1264G1Z0',
          seller_address: 'Behind New ITI, Gohana, Haryana 131301, India', seller_email: 'srkteamstar@gmail.com',
          seller_phone: '+91 90500 09442', seller_state: 'Haryana' }
    ],
    order_items: [
        { id: 1, order_id: 900, product_id: 1, product_name: 'Fake Machine', price: 1000, quantity: 1, total_amount: 1000 },
        { id: 2, order_id: 901, product_id: 1, product_name: 'Fake Machine', price: 1000, quantity: 2, total_amount: 2000 }
    ],
    order_shipping_address: [
        { id: 1, order_id: 900, full_address: '1 A Street', city: 'Gohana', state: 'Haryana', country: 'India', zip_code: '131301' },
        { id: 2, order_id: 901, full_address: '2 B Street', city: 'Sonipat', state: 'Haryana', country: 'India', zip_code: '131001' }
    ],
    // One COD row and one settled gateway-shaped row keep both invoice payment
    // presentations observable without giving the storefront a privileged
    // reporting route.
    payments: [
        { id: 1, order_id: 900, gateway: 'offline', payment_method: 'Cash on Delivery', amount: 1180,
          amount_paise: 118000, currency: 'INR', gateway_order_id: null, transaction_id: null,
          status: 'Pending', verified_at: null, created_at: '2026-02-01T00:00:00Z' },
        { id: 2, order_id: 901, gateway: 'razorpay', payment_method: 'upi', amount: 2360,
          amount_paise: 236000, currency: 'INR', gateway_order_id: 'order_SETTLED', transaction_id: 'pay_SETTLED',
          status: 'Paid', verified_at: '2026-02-02T00:05:00Z', created_at: '2026-02-02T00:00:00Z' }
    ],
    // Migration 014's append-only webhook log. Empty rather than absent: the
    // stub's insert pushes into `db[table] || []`, and an absent table means
    // that push lands in a throwaway array and every row silently vanishes.
    payment_events: [],
    // Migration 034's refund ledger. Empty for the same reason: apply_verified_refund()
    // below pushes a row per Razorpay refund id it claims, and an absent
    // table would silently swallow every one of them, defeating the very
    // dedup the fixture exists to prove.
    store_refunds: [],
    // Migration 017's per-customer cart. Empty for the same reason, and empty
    // rather than seeded on purpose: section 18 proves that one customer's
    // cart is invisible to another, and a fixture written by hand here would
    // let that pass without PUT /api/cart having stored anything.
    cart_items: [],
    // Migration 036's per-customer revision counter, read by GET /api/cart
    // and locked/incremented by the replace_customer_cart RPC below. Empty
    // for the same reason cart_items is: a customer with no row here reads
    // as revision 0, which is the RPC's own starting point.
    cart_revisions: [],
    products: [
        { id: 1, name: 'Fake Machine', url_slug: 'fake-machine', description: 'd', featured_description: null,
          price: '1000', category_id: 10, asset_folder: 'Fake Machine', is_active: true,
          is_featured: true, is_best_seller: false, is_new_arrival: false,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 2, name: 'Fake On Request', url_slug: 'fake-on-request', description: 'd', featured_description: null,
          price: 'On request', category_id: 10, asset_folder: 'Fake On Request', is_active: true,
          is_featured: false, is_best_seller: false, is_new_arrival: false,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
    ],
    product_images: [],

    // THE VIEW, not just the table. fetchProductRows() reads
    // `products_with_image` first and only falls back to `products` when the
    // view is genuinely MISSING — a 42P01/PGRST205 — and this stub answers an
    // unknown table with an empty list and no error at all. So the view read
    // "succeeded" with zero rows, the fallback never fired, and
    // /api/products/public returned [] on a fixture holding two products.
    //
    // Nothing noticed, because until the browser suite could run there was
    // nothing asking this stub for a storefront. Every product surface on the
    // site — the sections, the search overlay, the cart, the quote picker, the
    // details overlay — reads that one route, so the entire store was
    // untestable and looked fine.
    //
    // `categories_with_image` was already here, which is why category tabs
    // rendered and products did not.
    //
    // Kept in step with `products` by hand, exactly as categories_with_image
    // is: a fixture is a fixture, and the real view's job (joining one main
    // image per row) is what `image_url` stands in for.
    products_with_image: [
        { id: 1, name: 'Fake Machine', url_slug: 'fake-machine', description: 'd', featured_description: null,
          price: '1000', category_id: 10, category_name: 'Machinery', asset_folder: 'Fake Machine', is_active: true,
          is_featured: true, is_best_seller: false, is_new_arrival: false, image_url: null,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { id: 2, name: 'Fake On Request', url_slug: 'fake-on-request', description: 'd', featured_description: null,
          price: 'On request', category_id: 10, category_name: 'Machinery', asset_folder: 'Fake On Request', is_active: true,
          is_featured: false, is_best_seller: false, is_new_arrival: false, image_url: null,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
    ],

    categories: [
        { id: 10, name: 'Machinery', url_slug: 'machinery', description: 'c', parent_id: null,
          is_active: true, is_featured: true, image_path: null, product_count: 0, updated_at: '2026-01-01T00:00:00Z' },
        // SPELLED THE WAY THE LIVE TREE SPELLS IT. Every footer, the About page
        // and the home page link `#moulding`; the database says `moldings`. That
        // one missing letter silently sent all of those links to the default
        // tab, and this fixture is here so the catalogue's layered hash
        // resolution is tested against the drift rather than against a tree
        // tidied up to suit the test.
        { id: 11, name: 'Photo Frame Moldings', url_slug: 'moldings', description: 'c', parent_id: null,
          is_active: true, is_featured: false, image_path: null, product_count: 0, updated_at: '2026-01-01T00:00:00Z' }
    ],
    categories_with_image: [
        { id: 10, name: 'Machinery', url_slug: 'machinery', description: 'c', parent_id: null,
          is_active: true, is_featured: true, image_path: null, product_count: 0, updated_at: '2026-01-01T00:00:00Z' },
        { id: 11, name: 'Photo Frame Moldings', url_slug: 'moldings', description: 'c', parent_id: null,
          is_active: true, is_featured: false, image_path: null, product_count: 0, updated_at: '2026-01-01T00:00:00Z' }
    ],
    enquiries: [
        { id: 500, enquiry_type_id: 1, enquirer_name: 'Fake Enquirer', enquirer_business_name: null,
          enquirer_email: 'e@example.test', enquirer_phone_number: 9000000009,
          enquirer_text_message: 'help', status: 'Open', created_at: '2026-03-01T00:00:00Z' }
    ],
    form_types: [{ id: 1, type_name: 'enquiry' }],
    quote_requests: [
        { id: 600, business_name: 'Fake Biz', contact_name: 'Fake Person', email: 'q@example.test',
          phone: '9000000010', business_address: 'addr', notes: null, status: 'Open', created_at: '2026-03-02T00:00:00Z' }
    ],
    quote_request_items: [
        { id: 1, quote_request_id: 600, position: 1, category_id: 10, category_name: 'Machinery',
          product_id: 1, product_name: 'Fake Machine', product_price: 1000 }
    ],
    upcoming_projects: [
        { id: 700, project_category_title: 'c', project_name: 'p', project_description: 'd',
          is_visible: true, created_at: '2026-03-03T00:00:00Z' }
    ],
    site_settings: [{ key: 'upcoming_projects_section_visible', value: true }]
};

let nextId = 10000;

// THE UNIQUE INDEXES THAT CARRY THE IDEMPOTENCY GUARANTEE.
//
// Migration 014 creates these in Postgres; the stub has to honour them or the
// tests that matter most quietly pass for the wrong reason. A redelivered
// webhook only becomes a no-op because the second insert raises 23505 — with
// no constraint here, the stub would happily store it twice and the test
// would prove nothing.
//
// Partial, matching the migration: nulls do not collide (offline payment rows
// all carry transaction_id null and there are many of them).
const UNIQUE_INDEXES = {
    payment_events: ['event_id'],
    payments: ['transaction_id']
};

// Which columns an upsert with no explicit `onConflict` resolves against.
// PostgREST falls back to the primary key; site_settings is keyed on `key`
// rather than on an id, and is the one caller in server.js that omits the
// option. Everything else names its conflict target and never reaches this.
const UPSERT_DEFAULT_KEYS = {
    site_settings: ['key']
};

// ---- A chainable stub matching the slice of PostgREST that server.js uses ----
function makeQuery(table) {
    const state = { table, filters: [], op: 'select', payload: null, wantSingle: null, orders: [], range: null, count: null, head: false };

    const rows = () => (db[state.table] || []);

    const matches = (row) => state.filters.every(f => {
        const value = row[f.column];
        if (f.type === 'eq') return String(value) === String(f.value);
        if (f.type === 'in') return f.value.map(String).includes(String(value));
        // .or('is_active.eq.true,is_active.is.null') — product.repository.js's
        // active-or-null filter. Any one clause matching is enough, matching
        // PostgREST's own semantics for a single .or() call.
        if (f.type === 'or') return f.clauses.some(clause => clause.type === 'is'
            ? (clause.value === null ? (row[clause.column] === null || row[clause.column] === undefined) : row[clause.column] === clause.value)
            : String(row[clause.column]) === String(clause.value));
        return true;
    });

    const q = {
        // PostgREST's second argument: { count: 'exact', head: true } asks for
        // the number of matching rows without shipping any of them back. The
        // stub has to honour it or the route that counts a customer's orders
        // before deleting them reads `count` as undefined and concludes there
        // are none, which is exactly the check being tested.
        // EMBEDDED RESOURCES ARE PARSED, not ignored.
        //
        // This used to drop `columns` on the floor entirely, which is fine for
        // a plain column list and silently wrong for PostgREST's embed syntax:
        // `select('*, quote_request_items (*)')` came back as bare
        // quote_requests rows with no items on them at all. The route reads
        // `row.quote_request_items || []`, so it degraded to an empty list and
        // reported it as a successful read.
        //
        // That made the quote-quantity assertion in section 12 of
        // authz.test.js a test of nothing — it indexed into the empty array
        // the stub had handed back. The suite crashed on it rather than
        // failing cleanly, which is the only reason it was noticed at all.
        //
        // Same rule the unique-index emulation follows: the guarantee under
        // test IS the embed, so a stub that cannot express one cannot test it.
        select(columns, options) {
            if (options && options.count) state.count = options.count;
            if (options && options.head) state.head = true;

            // `name (*)` / `name(*)` — the embedded-resource form. Plain
            // column names carry no parentheses and are still ignored, which
            // is what every other caller here expects.
            if (typeof columns === 'string' && columns.indexOf('(') !== -1) {
                const embeds = [];
                const pattern = /([a-z_][a-z0-9_]*)\s*\(/gi;
                let match;
                while ((match = pattern.exec(columns)) !== null) embeds.push(match[1]);
                state.embeds = embeds;
            }

            return q;
        },
        eq(column, value) { state.filters.push({ type: 'eq', column, value }); return q; },
        in(column, value) { state.filters.push({ type: 'in', column, value }); return q; },
        // The one shape this stub's callers actually send: comma-separated
        // `column.eq.value` / `column.is.null` clauses, PostgREST's own OR
        // syntax. Not a general expression parser — just enough of it.
        or(clauseString) {
            const clauses = String(clauseString).split(',').map(part => {
                const match = part.match(/^([a-z_][a-z0-9_]*)\.(eq|is)\.(.+)$/i);
                if (!match) return null;
                const [, column, op, rawValue] = match;
                if (op === 'is') {
                    const value = rawValue === 'null' ? null : rawValue === 'true' ? true : rawValue === 'false' ? false : rawValue;
                    return { type: 'is', column, value };
                }
                return { type: 'eq', column, value: rawValue };
            }).filter(Boolean);
            state.filters.push({ type: 'or', clauses });
            return q;
        },
        order(column, options) {
            // Multiple .order() calls chain as tie-breakers, PostgREST-style
            // (product.repository.js orders by name then id). Stored as a
            // list; run() sorts by each in turn.
            state.orders.push({ column, asc: !options || options.ascending !== false });
            return q;
        },
        limit() { return q; },
        // .range(from, to) — PostgREST's inclusive offset/limit pagination.
        // Applied in run(), after sorting, before this stub answers.
        range(from, to) { state.range = { from, to }; return q; },
        // core/health/probes.js chains this onto a real request to cancel it
        // at the readiness budget. The stub has nothing to abort, so it is a
        // no-op that keeps the chain intact rather than a missing method.
        abortSignal() { return q; },
        insert(payload) { state.op = 'insert'; state.payload = payload; return q; },
        update(payload) { state.op = 'update'; state.payload = payload; return q; },
        upsert(payload, options) {
            state.op = 'upsert';
            state.payload = payload;
            state.onConflict = options && options.onConflict;
            return q;
        },
        delete() { state.op = 'delete'; return q; },
        maybeSingle() { state.wantSingle = 'maybe'; return q.then(); },
        single() { state.wantSingle = 'one'; return q.then(); },
        then(resolve, reject) { return run().then(resolve, reject); }
    };

    async function run() {
        try {
            let data;

            if (state.op === 'select') {
                data = rows().filter(matches).map(r => Object.assign({}, r));

                // One level of embedding, joined the way the real schema is:
                // the child carries `<singular parent>_id`. quote_requests ->
                // quote_request_items.quote_request_id, which is the one
                // embed this server actually asks for.
                //
                // PostgREST promises no order for an embedded resource, and
                // the route re-sorts them itself for exactly that reason — so
                // nothing is sorted here, deliberately. Ordering them would
                // hide a regression in the route's own sort.
                (state.embeds || []).forEach(name => {
                    const child = db[name];
                    if (!Array.isArray(child)) return;

                    const foreignKey = state.table.replace(/s$/, '') + '_id';
                    data.forEach(row => {
                        row[name] = child
                            .filter(item => String(item[foreignKey]) === String(row.id))
                            .map(item => Object.assign({}, item));
                    });
                });

                if (state.orders && state.orders.length) {
                    data.sort((a, b) => {
                        for (const { column, asc } of state.orders) {
                            const cmp = (a[column] > b[column] ? 1 : a[column] < b[column] ? -1 : 0) * (asc ? 1 : -1);
                            if (cmp !== 0) return cmp;
                        }
                        return 0;
                    });
                }

                if (state.range) data = data.slice(state.range.from, state.range.to + 1);
            } else if (state.op === 'insert') {
                const list = Array.isArray(state.payload) ? state.payload : [state.payload];
                const unique = UNIQUE_INDEXES[state.table] || [];

                for (const item of list) {
                    for (const column of unique) {
                        const value = item[column];
                        if (value === null || value === undefined) continue;
                        if (rows().some(row => String(row[column]) === String(value))) {
                            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${state.table}.${column}` } };
                        }
                    }
                }

                data = list.map(item => {
                    const row = Object.assign({ id: ++nextId, created_at: new Date().toISOString() }, item);
                    if (state.table === 'orders' && row.order_number === undefined) row.order_number = row.id;
                    rows().push(row);
                    return Object.assign({}, row);
                });
            } else if (state.op === 'update') {
                const hit = rows().filter(matches);
                hit.forEach(row => Object.assign(row, state.payload));
                data = hit.map(r => Object.assign({}, r));
            } else if (state.op === 'upsert') {
                // Split out from `update`, which it used to share. Sharing was
                // wrong in a way nothing had happened to notice: an upsert
                // carries no .eq() filters, so `matches` was true for every
                // row in the table and the payload was assigned over all of
                // them. PUT /api/cart is the first caller whose correctness
                // depends on the difference — it upserts a customer's lines
                // against (user_id, product_id), and the old branch would
                // have rewritten every other customer's cart to match, which
                // is the exact bug section 18 exists to catch.
                const list = Array.isArray(state.payload) ? state.payload : [state.payload];
                const keys = (state.onConflict
                    ? String(state.onConflict).split(',').map(part => part.trim()).filter(Boolean)
                    : (UPSERT_DEFAULT_KEYS[state.table] || []));

                data = list.map(item => {
                    const existing = keys.length
                        ? rows().find(row => keys.every(key => String(row[key]) === String(item[key])))
                        : null;

                    if (existing) {
                        Object.assign(existing, item);
                        return Object.assign({}, existing);
                    }

                    const row = Object.assign({ id: ++nextId, created_at: new Date().toISOString() }, item);
                    rows().push(row);
                    return Object.assign({}, row);
                });
            } else if (state.op === 'delete') {
                const keep = rows().filter(r => !matches(r));
                const removed = rows().filter(matches).map(r => Object.assign({}, r));
                db[state.table] = keep;
                data = removed;
            }

            if (state.count) {
                const total = Array.isArray(data) ? data.length : 0;
                return { data: state.head ? null : data, count: total, error: null };
            }

            if (state.wantSingle === 'maybe') return { data: data[0] || null, error: null };
            if (state.wantSingle === 'one') {
                if (!data.length) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
                return { data: data[0], error: null };
            }
            return { data, error: null };
        } catch (error) {
            return { data: null, error: { message: String(error) } };
        }
    }

    return q;
}

const fakeSupabase = {
    from: (table) => makeQuery(table),
    rpc: async (name, args) => {
        if (name === 'settle_captured_store_payment') {
            const payment = db.payments.find(row => String(row.id) === String(args.p_payment_id)
                && String(row.order_id) === String(args.p_order_id));
            const order = db.orders.find(row => String(row.id) === String(args.p_order_id));
            if (!payment || !order) return { data: null, error: { code: 'P0001', message: 'payment or order not found' } };

            // 035's fix: 'Paid' is not the only already-captured state. A
            // later or out-of-order capture event must not regress
            // 'Partially Refunded' / 'Refunded' back to 'Paid'.
            const CAPTURED_STATUSES = ['Paid', 'Partially Refunded', 'Refunded'];
            const already = CAPTURED_STATUSES.includes(payment.status);
            if (already) {
                if (String(payment.transaction_id) !== String(args.p_transaction_id)) {
                    return { data: null, error: { code: 'P0001', message: 'different transaction already settled' } };
                }
                // Leave status exactly as the refund ledger left it.
            } else {
                payment.transaction_id = args.p_transaction_id;
                payment.status = 'Paid';
                payment.payment_method = args.p_payment_method;
                payment.verified_at = args.p_verified_at;
            }

            if (order.status === 'Pending Payment') order.status = 'Processing';
            else if (order.status === 'Cancelled') order.status = 'Payment Review';

            return {
                data: {
                    already,
                    payment: Object.assign({}, payment),
                    order_status: order.status,
                    requires_review: order.status === 'Payment Review'
                },
                error: null
            };
        }

        if (name === 'apply_verified_refund') {
            // Mirrors migrations 034/apply_verified_refund() exactly, including
            // its message text — payments.controller.js classifies rejections
            // by matching a prefix of `error.message`, the same way it already
            // does for settle_captured_store_payment's 23505.
            const payment = db.payments.find(row => String(row.id) === String(args.p_payment_id)
                && String(row.order_id) === String(args.p_order_id));
            if (!payment) return { data: null, error: { code: 'P0001', message: 'payment not found for refund' } };

            // gateway_order_id is set at checkout time, so it is meaningful
            // to check regardless of capture state.
            if (payment.gateway !== args.p_gateway
                || String(payment.gateway_order_id) !== String(args.p_gateway_order_id)) {
                return { data: null, error: { code: 'P0001', message: 'refund payment binding mismatch' } };
            }
            if (String(payment.currency) !== String(args.p_currency)) {
                return { data: null, error: { code: 'P0001', message: 'refund currency mismatch' } };
            }

            const CAPTURED_STATUSES = ['Paid', 'Partially Refunded', 'Refunded'];
            if (!CAPTURED_STATUSES.includes(payment.status)) {
                // Not captured here yet — transaction_id is still null, so the
                // transaction-id binding check below has to wait until after
                // this gate, matching migration 034's ordering exactly.
                // Nothing written — not even the ledger row — so a later
                // delivery of this same refund id is free to apply once the
                // matching capture has settled.
                return { data: { status: 'not_yet_applicable', payment: Object.assign({}, payment) }, error: null };
            }

            // Captured, so transaction_id is now populated and meaningful.
            if (String(payment.transaction_id) !== String(args.p_gateway_payment_id)) {
                return { data: null, error: { code: 'P0001', message: 'refund payment binding mismatch' } };
            }

            const existing = db.store_refunds.find(row =>
                row.gateway === args.p_gateway && row.refund_id === args.p_refund_id);

            if (existing) {
                if (String(existing.payment_id) !== String(payment.id)
                    || Number(existing.amount_paise) !== Number(args.p_amount_paise)
                    || existing.currency !== args.p_currency) {
                    return { data: null, error: { code: 'P0001', message: 'refund identity mismatch' } };
                }
                return { data: { status: 'already_applied', payment: Object.assign({}, payment) }, error: null };
            }

            const priorSum = db.store_refunds
                .filter(row => String(row.payment_id) === String(payment.id))
                .reduce((sum, row) => sum + Number(row.amount_paise), 0);

            if (priorSum + Number(args.p_amount_paise) > Number(payment.amount_paise)) {
                return { data: null, error: { code: 'P0001', message: 'refund exceeds payment amount' } };
            }

            db.store_refunds.push({
                id: ++nextId,
                gateway: args.p_gateway,
                refund_id: args.p_refund_id,
                payment_id: payment.id,
                gateway_payment_id: args.p_gateway_payment_id,
                amount_paise: args.p_amount_paise,
                currency: args.p_currency,
                status: args.p_refund_status || null,
                created_at: new Date().toISOString()
            });

            const newSum = priorSum + Number(args.p_amount_paise);
            payment.status = newSum >= Number(payment.amount_paise) ? 'Refunded' : 'Partially Refunded';

            return { data: { status: 'applied', payment: Object.assign({}, payment) }, error: null };
        }

        if (name === 'create_quote_request') {
            if (control.consumeQuoteRpcMissing()) {
                return {
                    data: null,
                    error: {
                        code: 'PGRST202',
                        message: 'Could not find the function public.create_quote_request(p_items, p_request) in the schema cache'
                    }
                };
            }
            const request = Object.assign({
                id: ++nextId,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }, args.p_request);
            const items = (args.p_items || []).map(item => Object.assign({
                id: ++nextId,
                quote_request_id: request.id,
                created_at: new Date().toISOString()
            }, item));

            db.quote_requests.push(request);
            db.quote_request_items.push(...items);
            return { data: { id: request.id, created_at: request.created_at }, error: null };
        }

        if (name === 'replace_customer_cart') {
            const userId = args.p_user_id;
            const items = Array.isArray(args.p_items) ? args.p_items : [];

            let revRow = db.cart_revisions.find(row => String(row.user_id) === String(userId));
            if (!revRow) {
                revRow = { user_id: userId, revision: 0 };
                db.cart_revisions.push(revRow);
            }

            const expected = args.p_expected_revision;
            if (expected !== null && expected !== undefined && Number(expected) !== Number(revRow.revision)) {
                return { data: { conflict: true, revision: revRow.revision }, error: null };
            }

            // Same upsert-before-delete ordering as the real function and
            // the JS route it replaced.
            const keepIds = new Set(items.map(item => String(item.product_id)));
            items.forEach(item => {
                const existing = db.cart_items.find(row =>
                    String(row.user_id) === String(userId) && String(row.product_id) === String(item.product_id));
                if (existing) {
                    Object.assign(existing, {
                        quantity: item.quantity,
                        product_name: item.product_name || '',
                        product_price: item.product_price || '',
                        category_name: item.category_name || '',
                        image_url: item.image_url || ''
                    });
                } else {
                    db.cart_items.push(Object.assign({ id: ++nextId, user_id: userId }, {
                        product_id: item.product_id,
                        quantity: item.quantity,
                        product_name: item.product_name || '',
                        product_price: item.product_price || '',
                        category_name: item.category_name || '',
                        image_url: item.image_url || ''
                    }));
                }
            });
            db.cart_items = db.cart_items.filter(row =>
                String(row.user_id) !== String(userId) || keepIds.has(String(row.product_id)));

            revRow.revision = Number(revRow.revision) + 1;

            return {
                data: {
                    conflict: false,
                    revision: revRow.revision,
                    items: db.cart_items.filter(row => String(row.user_id) === String(userId)).map(r => Object.assign({}, r))
                },
                error: null
            };
        }

        if (name === 'fail_store_payment_setup') {
            // Mirrors migration 040's fail_store_payment_setup() exactly,
            // including its idempotent no-op when both rows have already been
            // retired by an earlier call.
            const order = db.orders.find(row => String(row.id) === String(args.p_order_id));
            if (!order) return { data: null, error: { code: 'P0001', message: 'order not found' } };

            const payment = db.payments.find(row => String(row.id) === String(args.p_payment_id)
                && String(row.order_id) === String(args.p_order_id));
            if (!payment) return { data: null, error: { code: 'P0001', message: 'payment not found for order' } };

            if (order.status === 'Cancelled' && payment.status === 'Failed') {
                return { data: null, error: null };
            }

            if (order.status !== 'Pending Payment' || payment.status !== 'Created') {
                return {
                    data: null,
                    error: { code: 'P0001', message: `order ${order.id} / payment ${payment.id} are not in the pre-failure state` }
                };
            }

            order.status = 'Cancelled';
            payment.status = 'Failed';
            return { data: null, error: null };
        }

        if (name === 'update_customer_profile_and_address') {
            // Mirrors migration 039's update_customer_profile_and_address()
            // exactly: one profile row, one addressed upserted by user_id,
            // written together or (via the throw below) not at all.
            const userId = args.p_user_id;
            if (userId === null || userId === undefined) {
                return { data: null, error: { code: 'P0001', message: 'user_id is required' } };
            }

            const profile = db.user_profiles.find(row => String(row.id) === String(userId));
            if (!profile) return { data: null, error: { code: 'P0001', message: 'profile not found' } };

            const p = args.p_profile;
            if (p && Object.keys(p).length) {
                if (p.full_name !== undefined && p.full_name !== null) profile.full_name = p.full_name;
                if (p.phone_number !== undefined && p.phone_number !== null) profile.phone_number = p.phone_number;
                if (p.phone_normalized !== undefined && p.phone_normalized !== null) profile.phone_normalized = p.phone_normalized;
                // company is the one nullable field — presence of the key, not
                // truthiness of its value, decides whether it is touched, same
                // as the SQL's `p_profile ? 'company'`.
                if (Object.prototype.hasOwnProperty.call(p, 'company')) profile.company = p.company;
                profile.updated_at = p.updated_at || new Date().toISOString();
            }

            const a = args.p_address;
            if (a && Object.keys(a).length) {
                let row = db.shipping_addresses.find(r => String(r.user_id) === String(userId));
                if (!row) {
                    row = { id: ++nextId, user_id: userId };
                    db.shipping_addresses.push(row);
                }
                row.full_address = a.full_address;
                row.city = a.city;
                row.state = a.state;
                row.country = a.country;
                row.zip_code = a.zip_code;
                row.updated_at = new Date().toISOString();
            }

            return { data: null, error: null };
        }

        if (name !== 'create_store_order') return { data: null, error: { message: `unstubbed RPC: ${name}` } };
        if (control.consumeAtomicCheckoutFailure()) {
            return { data: null, error: { message: 'forced atomic checkout failure' } };
        }

        const createdAt = new Date().toISOString();
        const orderNumber = nextId + 1;
        const order = Object.assign({
            id: ++nextId,
            order_number: orderNumber,
            user_id: args.p_user_id,
            created_at: createdAt,
            invoice_issued_at: createdAt,
            invoice_number: `INV-${createdAt.slice(0, 10).replace(/-/g, '')}-${String(orderNumber).padStart(6, '0')}`
        }, args.p_order);
        const items = (args.p_items || []).map(item => Object.assign({ id: ++nextId, order_id: order.id }, item));
        const shipping = Object.assign({ id: ++nextId, order_id: order.id }, args.p_shipping);
        const payment = Object.assign({ id: ++nextId, order_id: order.id, created_at: new Date().toISOString() }, args.p_payment);

        db.orders.push(order);
        db.order_items.push(...items);
        db.order_shipping_address.push(shipping);
        db.payments.push(payment);
        return { data: { order: Object.assign({}, order), payment: Object.assign({}, payment) }, error: null };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) }
};

// ---- Intercept the supabase module before server.js requires it -------------
const realResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    if (request === '@supabase/supabase-js') return '\0fake-supabase';
    return realResolve.call(this, request, ...rest);
};
require.cache['\0fake-supabase'] = {
    id: '\0fake-supabase', filename: '\0fake-supabase', loaded: true,
    exports: { createClient: () => fakeSupabase }
};

// ---- The stub gateway -------------------------------------------------------
//
// src/razorpay.js talks to Razorpay with global fetch, so replacing fetch is
// the same move the Supabase stub makes: intercept the boundary, leave the
// code under test untouched. No network call leaves this process.
//
// WHAT THE FAKE GATEWAY REPORTS IS ENCODED IN THE PAYMENT ID.
//
//     pay_<status>_<amountPaise>_<gatewayOrderId>
//
// so a test can ask for "captured, but 100 paise" or "authorised, not
// captured" without a control channel between the two processes — the test
// simply names the payment it wants when it posts the callback. Every branch
// of markOrderPaid()'s four conditions is reachable this way.
const RAZORPAY_KEY_SECRET = 'harness-razorpay-key-secret';
const RAZORPAY_WEBHOOK_SECRET = 'harness-razorpay-webhook-secret';

let gatewayOrderSeq = 0;

// Gateway orders the fake Razorpay should report money against.
//
// POST /api/orders/:id/cancel asks the gateway `amount_paid` before cancelling,
// because our own payments row is only as current as the last webhook we
// processed and a customer can be mid-modal in another tab. That refusal is the
// interesting branch, and it is the one gateway answer that cannot be chosen by
// naming a payment id the way every other one here is: the gateway ORDER id is
// minted by this stub, so a test can only point at it after the fact.
//
// run.js spawns the suites as separate processes from this one, so the channel
// is a small file both sides compute the same path for. See harness-control.js
// for why that is not over-engineering — an in-process Set here would be
// mutated in the test's copy and read from the server's, and would silently
// assert nothing.
control.reset();

const realFetch = globalThis.fetch;

globalThis.fetch = async function (url, options) {
    const href = String(url);

    if (!href.startsWith('https://api.razorpay.com/')) {
        return realFetch.call(this, url, options);
    }

    const json = (status, body) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });

    // Create an order.
    if (href.endsWith('/v1/orders') && (options || {}).method === 'POST') {
        // F01's reproduction: the local order row already exists (durable)
        // by the time this call happens, and THIS is the call that fails —
        // an outage or a 5xx from Razorpay, not a validation error. See
        // harness-control.failNextGatewayOrderCreate().
        if (control.consumeGatewayOrderCreateFailure()) {
            throw new Error('forced transient gateway order-create failure');
        }
        const sent = JSON.parse(options.body);
        gatewayOrderSeq += 1;
        return json(200, {
            id: `order_HARNESS${gatewayOrderSeq}`,
            amount: sent.amount,
            currency: sent.currency,
            receipt: sent.receipt,
            notes: sent.notes,
            status: 'created'
        });
    }

    // Read an order back. Only `status` and `amount_paid` are read by the
    // cancel route, but the shape is Razorpay's so a future caller reading
    // more does not silently get undefined.
    const orderMatch = href.match(/\/v1\/orders\/([^/?]+)$/);
    if (orderMatch && (options || {}).method !== 'POST') {
        const id = decodeURIComponent(orderMatch[1]);
        const paid = control.paidOrders().includes(id);
        return json(200, {
            id: id,
            entity: 'order',
            amount: 0,
            amount_paid: paid ? 1 : 0,
            amount_due: 0,
            currency: 'INR',
            status: paid ? 'paid' : 'created'
        });
    }

    // Read a payment back.
    const paymentMatch = href.match(/\/v1\/payments\/([^/?]+)$/);
    if (paymentMatch) {
        if (control.consumeGatewayPaymentFetchFailure()) {
            throw new Error('forced transient gateway failure');
        }
        const id = decodeURIComponent(paymentMatch[1]);
        const parts = id.split('_');
        // pay _ status _ amount _ order _ HARNESSn   -> the order id itself
        // contains an underscore, so the tail is rejoined rather than indexed.
        if (parts.length < 4 || parts[0] !== 'pay') {
            return json(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'no such payment' } });
        }
        return json(200, {
            id: id,
            status: parts[1],
            amount: Number(parts[2]),
            currency: 'INR',
            order_id: parts.slice(3).join('_'),
            method: 'upi'
        });
    }

    return json(404, { error: { code: 'NOT_FOUND', description: 'unstubbed razorpay path: ' + href } });
};

process.env.PORT = process.env.HARNESS_PORT || '3456';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';
process.env.SESSION_SECRET = 'harness-session-secret-that-is-long-enough-32';
// On by default, because the payments suite is the reason this harness knows
// about Razorpay at all. HARNESS_PAYMENTS_OFF boots the other configuration —
// the one this deployment runs today — so the offline flow can be proved
// unchanged rather than assumed to be.
if (process.env.HARNESS_PAYMENTS_OFF) delete process.env.PAYMENTS_ENABLED;
else process.env.PAYMENTS_ENABLED = '1';
process.env.RAZORPAY_KEY_ID = 'rzp_test_harness';
process.env.RAZORPAY_KEY_SECRET = RAZORPAY_KEY_SECRET;
process.env.RAZORPAY_WEBHOOK_SECRET = RAZORPAY_WEBHOOK_SECRET;
delete process.env.NODE_ENV;   // assertBootConfig refuses a test key under production
delete process.env.TRUST_PROXY;
delete process.env.ALLOWED_ORIGINS;

// The real file, not a copy — a copied server.js is a test that
// silently stops testing the thing it names.
require(path.join(__dirname, '..', 'server.js'));

module.exports = { db, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET };
