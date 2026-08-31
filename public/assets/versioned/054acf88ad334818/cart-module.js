/**
 * cart-module.js
 *
 * The store's cart: what is in it, where it is kept, the drawer that shows it,
 * the badge on the header button, and the wiring that makes every add-to-cart
 * glyph on the page do something.
 *
 * Until now all of that was markup. `store/store.html`'s header button and the
 * button `product-section-shared-module.js` draws on every card both carried
 * `onclick="event.stopPropagation();"` and nothing else, so the only thing a
 * click achieved was not opening the card behind it.
 *
 * ONE MODULE, NOT THREE
 * ---------------------
 * State, storage and the drawer live together, the way request-quote-module.js
 * owns the whole of its feature. Splitting them would mean a load-order rule
 * between three files that are useless apart, on a page where load order is
 * already load-bearing in five places.
 *
 * WIRING IS DELEGATED, AND HAS TO BE
 * ----------------------------------
 * The cart button on a card is matched through one listener on `document`, not
 * bound per button. product-section-shared-module.js replaces the whole of
 * #dynamic-view every time a sidebar section is opened, so a listener bound to
 * a button dies with the first nav click. The product is read from the card's
 * ancestor `article[data-product-id]`, which that module already emits.
 *
 * DATA SOURCE
 * -----------
 * Lines are stored by product id and re-resolved against
 * `window.productSection.loadProducts()` — the same cached promise the four
 * product sections and the quote overlay read, so opening the cart after
 * browsing costs no request and a line can never show a price the shelf does
 * not.
 *
 * Each line also *snapshots* the name, price, category and image as they read
 * when it was added. This is the reasoning 009_quote_requests.sql already
 * applies to `quote_request_items`: the live row wins while it exists, so an
 * admin's price edit shows up; but a product that is deleted or deactivated
 * must not make a line silently vanish out from under someone. It stays,
 * marked unavailable, and says so.
 *
 * A CART HAS EXACTLY ONE OWNER
 * ----------------------------
 * This used to be one localStorage key, `srk_cart`, with nothing in it that
 * said whose cart it was. That is one basket per *browser*, not one per
 * customer, and it showed:
 *
 *   * sign in, fill a cart, sign out — the lines were still on screen for
 *     whoever used that machine next;
 *   * a second customer signing in on the same machine inherited them;
 *   * a visitor who never signed in left one behind that outlived their whole
 *     visit, because localStorage has no session to end.
 *
 * So the cart now belongs to somebody, and where it is kept follows from who
 * that is:
 *
 *   SIGNED IN   the server, in cart_items, through GET / PUT /api/cart behind
 *               requireCustomer (migration 017). It follows the customer to
 *               another device, and signing out does not destroy it — it stops
 *               it being reachable, which is a different thing and the one
 *               worth having: a buyer who assembled a twelve-line order and
 *               signed out by accident has not lost their afternoon.
 *
 *   GUEST       sessionStorage, which the tab throws away when it closes. That
 *               is the whole of what a guest cart should outlive. localStorage
 *               never was, and on a shared terminal it was actively wrong.
 *
 * `lines` in this module is the synchronous truth for the page — items(),
 * count() and totals() are called during render and cannot await anything —
 * and `persist()` is what pushes it to whichever of those two owns it.
 *
 * SIGNING IN WITH A CART IN YOUR HAND
 * -----------------------------------
 * A guest fills a basket and then signs in to an account that already has one.
 * Both are real, and quietly picking either is a bug the customer watches
 * happen: dropping the guest lines throws away what they just chose, and
 * dropping the saved ones throws away what they chose last week. So when both
 * have lines, adopt() asks — see mergeDialog(). When only one has lines there
 * is no question to ask and none is asked.
 *
 * EVERY STORAGE CALL IS WRAPPED, AND SO IS EVERY FETCH
 * ----------------------------------------------------
 * A browser that throws on storage (private mode, a full quota) degrades to a
 * cart that works for this page load. A server that cannot be reached degrades
 * the same way — with one hard rule in adopt(): a failed read is NOT an empty
 * account cart, and must never be treated as one. Believing it would upload a
 * guest basket over somebody's saved one and call it a merge.
 *
 * PRICES ARE TEXT, SO TOTALS ARE CAREFUL
 * --------------------------------------
 * `products.price` is a `text` column and "On request" is a legal value — most
 * rows in this catalogue have no number at all. So the subtotal counts only the
 * lines that parse, and the footer says how many it counted and how many it
 * could not. A B2B buyer may act on that figure; it must not quietly understate
 * itself.
 *
 * CHECKOUT
 * --------
 * "Proceed to Checkout" leads to store/checkout.html, which prices the basket
 * server-side and writes a real order. It used to ship disabled, because there
 * was no /api/checkout to send it to.
 *
 * The quote overlay is still one click away, and is the only route for the
 * products priced "On request", which checkout cannot total.
 *
 * WHAT THE FOOTER LINE SAYS, AND WHY IT NO LONGER SAYS THE OTHER THING
 * -------------------------------------------------------------------
 * It used to open "No payment is taken online." That is a fact about our
 * plumbing, and a customer looking at a basket is not asking about our
 * plumbing — leading with what we do *not* do reads as a limitation being
 * apologised for. The line now says the thing they are actually about to
 * want: that delivery and GST are worked out at the next step, and that a
 * formal quotation is available for anything needing one. What happens after
 * an order is placed belongs on the confirmation, where it is answering a
 * question somebody has.
 *
 * LOAD ORDER
 * ----------
 * After product-section-shared-module.js, store-overlay-shared-module.js,
 * price-format-module.js and — new, and the reason store/checkout.html's
 * script order changed — customer-session-module.js, which this now reads to
 * know whose cart it is holding. Before view-state-restore-module.js, which
 * must stay last on the page.
 *
 * The session module is read defensively rather than guarded on: a page that
 * loads this without it gets a guest cart forever, which is the correct
 * reading of "nobody is signed in here" and not a failure.
 */

(() => { // IIFE to prevent variable collisions with other modules
    'use strict';

    if (window.storeCart) return;

    const section = window.productSection;
    if (!section) {
        console.error('cart-module.js needs product-section-shared-module.js loaded first.');
        return;
    }

    const chrome = window.storeOverlay;
    if (!chrome) {
        console.error('cart-module.js needs store-overlay-shared-module.js loaded first.');
        return;
    }

    const { escapeHtml, resolveMainImage } = section;

    const {
        PRIMARY_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES, EYEBROW_CLASSES,
        TRASH_ICON, PLUS_ICON, MINUS_ICON, BAG_ICON, CHECK_ICON,
        centredMessageHTML, prefersReducedMotion, ensureStyles
    } = chrome;

    // The customer session, when the page has one. Read through this handle
    // rather than off `window` at each call site, so the "this page did not
    // load it" case is answered once.
    const account = window.customerSession || null;

    // sessionStorage now, not localStorage — the guest cart dies with the tab.
    // The key name is unchanged because the two are separate namespaces, so
    // nothing collides, and because the old name is what every note about this
    // module already says.
    const STORAGE_KEY = 'srk_cart';

    // Where the browser-wide cart used to live. Read once at startup and then
    // deleted — see adoptLegacyCart(). Not left alone: it is the very thing
    // this change exists to remove, and one that outlives the change is a
    // basket sitting on a shared machine forever.
    const LEGACY_STORAGE_KEY = 'srk_cart';

    // Bumped only if the stored shape changes in a way an old blob cannot be
    // read as. A mismatch drops the cart rather than half-reading it.
    const STORAGE_VERSION = 1;

    const MAX_QUANTITY = 99;

    // A burst of + clicks is one write, not eight. Long enough to collapse a
    // person operating a stepper, short enough that closing the tab straight
    // after a change almost never outruns it — and `pagehide` flushes whatever
    // it does outrun, so "almost never" is not doing the work.
    const WRITE_DEBOUNCE_MS = 400;

    // How long the card's button shows a tick after an add. Long enough to
    // register, short enough that a second add re-triggers it cleanly.
    const CONFIRM_MS = 1100;

    // ------------------------------------------------------------------
    // STYLES
    // ------------------------------------------------------------------
    const STYLE_ID = 'store-cart-styles';

    const CSS = [
        /* The count bubble on the header button. Absolutely positioned, so it
           does not change the button's 44px box and push the search row. */
        '#cart-count{position:absolute;top:-2px;right:-2px;min-width:18px;height:18px;padding:0 5px;',
        'border-radius:9px;background:#d4af37;color:#fff;font-size:10px;font-weight:700;line-height:18px;',
        'text-align:center;pointer-events:none;transition:transform 200ms ease;}',
        '#cart-count.is-bumped{transform:scale(1.35);}',

        /* The quantity field. `appearance:none` because the spinner arrows are
           the browser's, sized to its own font, and would not line up with the
           two square buttons either side. */
        '.cart-qty-input{-moz-appearance:textfield;appearance:none;}',
        '.cart-qty-input::-webkit-outer-spin-button,.cart-qty-input::-webkit-inner-spin-button{',
        '-webkit-appearance:none;margin:0;}',

        '@media (prefers-reduced-motion:reduce){',
        '#cart-count{transition:none;}',
        '}'
    ].join('');

    // ------------------------------------------------------------------
    // STATE
    // ------------------------------------------------------------------
    // A line is { id, name, category_name, price, image_url, quantity }.
    // `price` is kept as the raw catalogue text, not a number, so a line can
    // render "On request" exactly as the card did.
    let lines = [];

    // WHO THIS CART BELONGS TO.
    //
    // A customer id (as a string) when these lines are a signed-in customer's
    // *and this browser has successfully read them*, or null in every other
    // case — a guest, and also a signed-in customer whose cart could not be
    // fetched. That second case is the important one: "signed in" and "holding
    // this customer's cart" are different facts, and persist() must key on the
    // second. Set only by adopt(), and only after a successful read, which is
    // what makes `ownerId` non-null mean "safe to write to the server".
    let ownerId = null;

    // Whether the question "whose cart is this" has been answered yet — which
    // is not the same as answered *well*. A read that failed still settles it:
    // the lines fall back to being a guest cart, which is honest, and the
    // drawer must not sit on a loading state for the rest of the visit.
    let settled = false;

    let handle = null;          // the open drawer, or null
    const listeners = [];

    function notify() {
        listeners.forEach(fn => {
            try {
                fn();
            } catch (error) {
                console.error('Cart listener failed.', error);
            }
        });
    }

    // ------------------------------------------------------------------
    // PERSISTENCE — THE GUEST HALF
    // ------------------------------------------------------------------
    // sessionStorage, so it dies with the tab. Both calls are wrapped: a
    // browser that throws on storage still gets a cart that works for this
    // page load, which is a smaller loss than a store that will not render.
    function readGuest() {
        let raw;
        try {
            raw = window.sessionStorage.getItem(STORAGE_KEY);
        } catch (error) {
            console.warn('Cart: storage unavailable, keeping the cart in memory only.', error);
            return [];
        }

        return decode(raw);
    }

    function writeGuest() {
        try {
            window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, items: lines }));
        } catch (error) {
            console.warn('Cart: could not save the cart.', error);
        }
    }

    function clearGuestStorage() {
        try {
            window.sessionStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            // Nothing to do and nothing to say — the lines are gone from
            // memory either way, and a browser refusing to forget one key is
            // not something the customer can act on.
        }
    }

    // The browser-wide cart this change exists to remove. Read once, adopted
    // as the guest cart for this tab, and deleted.
    //
    // Adopted rather than dropped, deliberately: on the deploy that ships this
    // there are real people with real baskets in that key, and throwing them
    // away to make a point about hygiene would be the wrong trade. Deleted
    // rather than left, equally deliberately: a key that outlives this change
    // is a basket sitting on a shared machine forever, which is the whole bug.
    // One page load and it is gone for good.
    function adoptLegacyCart() {
        let raw;
        try {
            raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
        } catch (error) {
            return [];
        }

        if (!raw) return [];

        try {
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch (error) {
            // Read but not removable. The lines are still adopted below, and
            // the next load will simply try again.
        }

        return decode(raw);
    }

    function decode(raw) {
        if (!raw) return [];

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            console.warn('Cart: stored cart was unreadable and has been dropped.', error);
            return [];
        }

        if (!parsed || parsed.v !== STORAGE_VERSION || !Array.isArray(parsed.items)) return [];

        return parsed.items
            .map(normalise)
            .filter(Boolean);
    }

    // ------------------------------------------------------------------
    // PERSISTENCE — THE SIGNED-IN HALF
    // ------------------------------------------------------------------
    // GET returns an array, or null for "could not read". The distinction is
    // the whole reason this does not just return [] on failure: adopt() has to
    // be able to tell an empty account cart from an unreachable one, and
    // conflating them uploads a guest basket over a saved one.
    async function serverRead() {
        let response;

        try {
            response = await fetch('/api/cart', {
                method: 'GET',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            console.warn('Cart: could not reach the server to read your cart.', error);
            return null;
        }

        if (!response.ok) return null;

        let payload = null;
        try {
            payload = await response.json();
        } catch (error) {
            return null;
        }

        if (!payload || !Array.isArray(payload.items)) return null;

        return payload.items.map(normalise).filter(Boolean);
    }

    // Every PUT carries the complete cart, which is what makes a failed one
    // cheap: nothing is queued for retry and nothing needs to be, because the
    // next write that lands says everything this one would have.
    async function serverWrite(items, keepalive) {
        try {
            const response = await fetch('/api/cart', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: items }),
                // Set only on the pagehide flush. A keepalive request survives
                // the document being torn down, which is the entire point
                // there and pointless overhead everywhere else.
                keepalive: keepalive === true
            });

            if (!response.ok) {
                console.warn('Cart: the server refused a cart update (' + response.status + ').');
            }
        } catch (error) {
            console.warn('Cart: could not save your cart to the server.', error);
        }
    }

    // ------------------------------------------------------------------
    // PERSISTENCE — WHICHEVER ONE OWNS THIS CART
    // ------------------------------------------------------------------
    let writeTimer = null;

    // `immediate` is for the writes where a debounce is a real risk of loss
    // rather than a saving: clear(), which checkout calls the moment an order
    // is placed, and the adopt() that follows a sign-in.
    function persist(options) {
        // No owner means no account cart to write to — either nobody is signed
        // in, or somebody is and this browser could not read their cart. Both
        // are a guest cart as far as storage goes, and the second is the
        // safer answer than it looks: writing a cart we failed to read would
        // overwrite a saved basket with whatever happened to be on screen.
        if (!ownerId) {
            writeGuest();
            return;
        }

        if (writeTimer !== null) {
            window.clearTimeout(writeTimer);
            writeTimer = null;
        }

        if (options && options.immediate) {
            serverWrite(snapshot());
            return;
        }

        const owner = ownerId;
        writeTimer = window.setTimeout(() => {
            writeTimer = null;
            // The session may have changed while this was pending, in which
            // case these lines belong to somebody who is no longer here.
            if (ownerId !== owner) return;
            serverWrite(snapshot());
        }, WRITE_DEBOUNCE_MS);
    }

    // Fired when the page is going away with a debounced write still pending —
    // clicking through to checkout inside the debounce window is the ordinary
    // way that happens. keepalive is what lets the request outlive the document.
    function flushPendingWrite() {
        if (writeTimer === null) return Promise.resolve();

        window.clearTimeout(writeTimer);
        writeTimer = null;

        if (ownerId) return serverWrite(snapshot(), true);
        return Promise.resolve();
    }

    const snapshot = () => lines.map(line => Object.assign({}, line));

    // ------------------------------------------------------------------
    // OWNERSHIP
    // ------------------------------------------------------------------
    // Everything below answers one question — whose cart is on screen — and
    // adopt() is the only thing allowed to change the answer.

    const currentOwnerId = () => {
        if (!account || typeof account.current !== 'function') return null;
        const profile = account.current();
        return profile && profile.id !== undefined && profile.id !== null ? String(profile.id) : null;
    };

    // Union by product id, quantity taken as the higher of the two rather than
    // the sum. Somebody who put 3 in as a guest and had 2 saved wants 3, not 5
    // — they were describing the same intention twice, not adding to it. The
    // saved line's snapshot wins where both exist, being the older record; it
    // is re-resolved against the live catalogue on the next paint anyway.
    function mergeLines(saved, guest) {
        const merged = saved.map(line => Object.assign({}, line));
        const byId = new Map(merged.map(line => [line.id, line]));

        guest.forEach(line => {
            const existing = byId.get(line.id);

            if (!existing) {
                merged.push(Object.assign({}, line));
                return;
            }

            existing.quantity = clampQuantity(Math.max(existing.quantity, line.quantity)) || existing.quantity;
        });

        return merged;
    }

    // The question, asked only when both carts have lines — which is the only
    // time there is one. Resolves to the lines to keep.
    //
    // A NULL FROM openChoiceDialog IS ANSWERED, NOT IGNORED. It refuses when
    // another dialog is already open, and a surface that treated that as "do
    // nothing" would silently drop the guest lines. Merging is the answer that
    // loses nothing, so it is what an unaskable question resolves to.
    function askWhichCart(saved, guest) {
        if (!chrome.openChoiceDialog) return Promise.resolve(mergeLines(saved, guest));

        const count = (list) => list.length + (list.length === 1 ? ' item' : ' items');

        return new Promise((resolve) => {
            const opened = chrome.openChoiceDialog({
                idPrefix: 'cart-merge-dialog',
                // Not dismissible. Escape would have to silently pick one of
                // these two answers, and picking one silently is the thing
                // this dialog exists to stop.
                dismissible: false,
                title: 'You have two carts',
                body: [
                    '<p>Your account already has a saved cart with <span class="font-bold text-[#12170f]">' +
                        escapeHtml(count(saved)) + '</span> in it, and you added <span class="font-bold text-[#12170f]">' +
                        escapeHtml(count(guest)) + '</span> before signing in.</p>',
                    '<p class="text-[#12170f] font-semibold">Which would you like to keep?</p>'
                ].join(''),
                actions: [
                    {
                        label: 'Just the saved cart',
                        onPick: () => resolve(saved)
                    },
                    {
                        label: 'Keep both',
                        primary: true,
                        onPick: () => resolve(mergeLines(saved, guest))
                    }
                ]
            });

            if (!opened) resolve(mergeLines(saved, guest));
        });
    }

    // Guards against two adopt() runs overlapping — the session module can
    // notify more than once around a sign-in, and the second must not race the
    // first's dialog or its write.
    let adopting = null;

    function adopt() {
        if (adopting) return adopting;

        adopting = run().finally(() => { adopting = null; });
        return adopting;

        async function run() {
            const nextOwner = currentOwnerId();

            // Nothing to do: the answer is already this one. Note the check is
            // on `ownerId`, so a signed-in customer whose cart failed to load
            // has ownerId null, does not match, and is retried every time this
            // is called — which is what makes open() a recovery path rather
            // than a second copy of this logic.
            if (nextOwner === ownerId && settled) return;

            // A DIFFERENT CUSTOMER'S LINES GO FIRST, BEFORE ANYTHING ELSE.
            // They are not this person's, so they must not be shown to them,
            // and — the part that would actually be a bug — they must not be
            // treated as unsaved lines to merge into the new account's cart
            // further down.
            //
            // Nothing is deleted anywhere by this: the previous customer's
            // cart is on the server, exactly as they left it. What goes is
            // this browser's view of it, which is the whole of what signing
            // out should mean for a cart.
            if (ownerId && ownerId !== nextOwner) {
                lines = [];
                ownerId = null;
                clearGuestStorage();
            }

            // ---- SIGNED OUT, OR NEVER IN --------------------------------
            if (!nextOwner) {
                settled = true;
                notify();
                return;
            }

            // ---- SIGNED IN ----------------------------------------------
            // Whatever is on screen that the server has never seen: a guest
            // cart built before signing in, or lines added after a read that
            // failed. Captured before the await, so the two halves being
            // compared are both from before the round trip.
            const unsaved = snapshot();

            const saved = await serverRead();

            // A SERVER WE COULD NOT REACH IS NOT AN EMPTY CART. `ownerId`
            // stays null, so nothing is written to the account and the saved
            // basket cannot be overwritten by what this browser happens to be
            // holding. The lines stay on screen and stay in sessionStorage —
            // as a guest cart, which is what they honestly are — and the next
            // adopt() (a session notify, or opening the drawer) tries again
            // and folds them in.
            if (saved === null) {
                console.warn('Cart: could not load your saved cart; keeping this one for now.');
                settled = true;
                notify();
                return;
            }

            let keep;

            if (!unsaved.length) keep = saved;
            else if (!saved.length) keep = unsaved;
            else keep = await askWhichCart(saved, unsaved);

            // The session can end while a dialog is open — this is the one
            // await long enough for that to be ordinary rather than exotic.
            if (currentOwnerId() !== nextOwner) return;

            ownerId = nextOwner;
            lines = keep.map(line => Object.assign({}, line));
            settled = true;

            // Those lines have been dealt with either way now: folded in, or
            // deliberately let go. Leaving them in sessionStorage would hand
            // them straight back at the next sign-out.
            clearGuestStorage();

            // Only when the server does not already agree. Adopting a saved
            // cart untouched is a read, and a PUT there would be a write with
            // nothing to say.
            if (keep !== saved) persist({ immediate: true });

            notify();
        }
    }

    // Everything that comes back out of storage is treated as untrusted: it was
    // written by an older version of this file, or edited by hand.
    function normalise(entry) {
        if (!entry || entry.id === null || entry.id === undefined) return null;

        const quantity = clampQuantity(entry.quantity);
        if (!quantity) return null;

        return {
            id: String(entry.id),
            name: String(entry.name || ''),
            category_name: String(entry.category_name || ''),
            price: entry.price === null || entry.price === undefined ? '' : String(entry.price),
            image_url: entry.image_url ? String(entry.image_url) : '',
            quantity
        };
    }

    function clampQuantity(value) {
        const parsed = parseInt(value, 10);
        if (!isFinite(parsed) || parsed < 1) return 0;
        return Math.min(parsed, MAX_QUANTITY);
    }

    // ------------------------------------------------------------------
    // CATALOGUE
    // ------------------------------------------------------------------
    // Resolves every line against the live catalogue. Deliberately never
    // rejects: a cart that cannot reach the API is still worth showing from its
    // own snapshots, which is the whole reason the snapshots are there.
    async function resolved() {
        let products = [];
        try {
            products = await section.loadProducts();
        } catch (error) {
            console.warn('Cart: catalogue unavailable, showing saved details.', error);
        }

        const byId = new Map(products.map(product => [String(product.id), product]));

        return lines.map(line => {
            const live = byId.get(line.id);

            if (!live) {
                return Object.assign({}, line, {
                    available: products.length === 0 ? true : false,
                    // With no catalogue at all we cannot tell "withdrawn" from
                    // "could not check", and calling everything withdrawn would
                    // be a lie the customer cannot act on.
                    unknown: products.length === 0
                });
            }

            return {
                id: line.id,
                name: live.name || line.name,
                category_name: live.category_name || line.category_name,
                price: live.price === null || live.price === undefined ? '' : String(live.price),
                image_url: resolveMainImage(live) || line.image_url,
                quantity: line.quantity,
                available: true,
                unknown: false
            };
        });
    }

    // ------------------------------------------------------------------
    // PUBLIC STATE
    // ------------------------------------------------------------------
    function find(id) {
        return lines.find(line => line.id === String(id)) || null;
    }

    function count() {
        return lines.reduce((total, line) => total + line.quantity, 0);
    }

    async function add(productId, quantity) {
        // Waited on before anything is touched. A click that lands in the
        // gap between page load and the first GET /api/cart would otherwise
        // push a line into `lines`, and adopt() would then replace `lines`
        // wholesale with what the server said — swallowing it. This function
        // was already async and every caller already awaits it, so the wait
        // costs nothing anybody can feel.
        await ready;

        const id = String(productId);
        const wanted = clampQuantity(quantity === undefined ? 1 : quantity) || 1;

        const existing = find(id);
        if (existing) {
            existing.quantity = Math.min(existing.quantity + wanted, MAX_QUANTITY);
        } else {
            // The snapshot is taken here, from the catalogue rather than from
            // the card's rendered text: the card shows a formatted price and a
            // truncated name, neither of which round-trips.
            let product = null;
            try {
                const products = await section.loadProducts();
                product = products.find(entry => String(entry.id) === id) || null;
            } catch (error) {
                console.warn('Cart: could not read the catalogue to add this product.', error);
            }

            if (!product) {
                console.warn('Cart: product ' + id + ' is not in the catalogue; not adding it.');
                return false;
            }

            lines.push({
                id,
                name: String(product.name || ''),
                category_name: String(product.category_name || ''),
                price: product.price === null || product.price === undefined ? '' : String(product.price),
                image_url: resolveMainImage(product) || '',
                quantity: wanted
            });
        }

        persist();
        notify();
        return true;
    }

    function setQuantity(id, quantity) {
        const line = find(id);
        if (!line) return;

        const next = clampQuantity(quantity);
        if (!next) {
            remove(id);
            return;
        }

        line.quantity = next;
        persist();
        notify();
    }

    function remove(id) {
        const key = String(id);
        const before = lines.length;
        lines = lines.filter(line => line.id !== key);
        if (lines.length === before) return;

        persist();
        notify();
    }

    function clear() {
        if (!lines.length) return;
        lines = [];
        // Not debounced. checkout-module.js calls this the instant the server
        // confirms an order, and the customer may well close the tab on the
        // confirmation screen — a cart that outlives the order it became is
        // the one wrong answer here.
        persist({ immediate: true });
        notify();
    }

    // ------------------------------------------------------------------
    // TOTALS
    // ------------------------------------------------------------------
    // Returns { amount, priced, unpriced, items } — priced and unpriced being
    // counts of *lines*, not units, because that is what the footer sentence
    // needs to say.
    function totalsFor(list) {
        const parse = window.parseProductPrice || (() => null);

        let amount = 0;
        let priced = 0;
        let unpriced = 0;

        list.forEach(line => {
            const unit = parse(line.price);
            if (unit === null) {
                unpriced += 1;
                return;
            }

            priced += 1;
            amount += unit * line.quantity;
        });

        return { amount, priced, unpriced, items: list.length };
    }

    // ------------------------------------------------------------------
    // BADGE
    // ------------------------------------------------------------------
    function refreshBadge() {
        const badge = document.getElementById('cart-count');
        if (!badge) return;

        const total = count();

        // The bubble is aria-hidden because it is a visual duplicate, so the
        // count has to reach assistive tech some other way or it does not
        // reach it at all — the button said only "Open cart" however full the
        // cart was. It carries the real number even when the bubble is
        // showing "99+".
        const button = document.getElementById('cart-button');
        if (button) {
            button.setAttribute('aria-label', total
                ? 'Open cart, ' + total + (total === 1 ? ' item' : ' items')
                : 'Open cart');
        }

        if (!total) {
            badge.textContent = '';
            badge.classList.add('hidden');
            return;
        }

        badge.classList.remove('hidden');
        badge.textContent = total > 99 ? '99+' : String(total);
    }

    function bumpBadge() {
        const badge = document.getElementById('cart-count');
        if (!badge || prefersReducedMotion()) return;

        badge.classList.add('is-bumped');
        window.setTimeout(() => badge.classList.remove('is-bumped'), 200);
    }

    // ------------------------------------------------------------------
    // MARKUP
    // ------------------------------------------------------------------
    function thumbHTML(line) {
        const name = escapeHtml(line.name);

        // Same swap the product card uses: the placeholder replaces the image
        // rather than sitting behind it, because a mix-blend-multiply image
        // over a stand-in reads as a watermark.
        return line.image_url
            ? '<img src="' + escapeHtml(line.image_url) + '" alt="" loading="lazy"' +
              ' class="w-full h-full object-contain mix-blend-multiply"' +
              ' onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';" />' +
              '<div class="absolute inset-1 items-center justify-center text-center text-[#12170f]/30 text-[10px] font-semibold" style="display:none">' + name + '</div>'
            : '<div class="absolute inset-1 flex items-center justify-center text-center text-[#12170f]/30 text-[10px] font-semibold">' + name + '</div>';
    }

    function stepperHTML(line) {
        const buttonClasses = 'store-icon w-8 h-8 flex items-center justify-center rounded-sm border border-[#12170f]/10 bg-white hover:border-[#d4af37] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37] disabled:opacity-40 disabled:cursor-not-allowed';

        return [
            '<div class="flex items-center gap-1.5">',
            '    <button type="button" class="' + buttonClasses + '" data-cart-action="decrease" data-cart-id="' + escapeHtml(line.id) + '"',
            '            aria-label="Reduce quantity of ' + escapeHtml(line.name) + '"' + (line.quantity <= 1 ? ' disabled' : '') + '>',
            '        ' + MINUS_ICON,
            '    </button>',
            '    <input autocomplete="srk-no-autofill" spellcheck="false" type="text" inputmode="numeric"',
            '           class="cart-qty-input w-11 h-8 text-center text-sm font-bold text-[#12170f] bg-white border border-[#12170f]/10 rounded-sm focus:outline-none focus:ring-2 focus:ring-[#d4af37]"',
            '           value="' + line.quantity + '" data-cart-qty data-cart-id="' + escapeHtml(line.id) + '"',
            '           aria-label="Quantity of ' + escapeHtml(line.name) + '" />',
            '    <button type="button" class="' + buttonClasses + '" data-cart-action="increase" data-cart-id="' + escapeHtml(line.id) + '"',
            '            aria-label="Increase quantity of ' + escapeHtml(line.name) + '"' + (line.quantity >= MAX_QUANTITY ? ' disabled' : '') + '>',
            '        ' + PLUS_ICON,
            '    </button>',
            '</div>'
        ].join('\n');
    }

    function lineHTML(line) {
        const format = window.formatProductPrice || (value => value);
        const amount = window.formatAmount || (() => '');
        const parse = window.parseProductPrice || (() => null);

        const unit = parse(line.price);
        const unitLabel = format(line.price) || 'Price on request';
        const lineTotal = unit === null ? '' : amount(unit * line.quantity);

        const warning = line.available
            ? ''
            : '<p class="text-[11px] font-bold text-red-600 mt-1">' +
              (line.unknown
                  ? 'Could not confirm this product is still listed.'
                  : 'No longer available — remove it, or ask us about it in a quote.') +
              '</p>';

        return [
            '<div class="flex gap-4 py-5 border-b border-[#12170f]/5" data-cart-line="' + escapeHtml(line.id) + '">',
            '    <div class="relative w-16 h-16 shrink-0 bg-[#f1f5f9] rounded-sm overflow-hidden flex items-center justify-center p-2">',
            '        ' + thumbHTML(line),
            '    </div>',
            '    <div class="flex-1 min-w-0">',
            '        <div class="flex items-start justify-between gap-3">',
            '            <div class="min-w-0">',
            '                <h3 class="text-sm font-bold text-[#12170f] leading-snug line-clamp-2">' + escapeHtml(line.name) + '</h3>',
            line.category_name
                ? '                <p class="text-[10px] text-[#1f271b]/60 uppercase tracking-wider mt-0.5 truncate">' + escapeHtml(line.category_name) + '</p>'
                : '',
            '            </div>',
            '            <button type="button" class="store-icon store-icon--danger w-8 h-8 shrink-0 rounded-full flex items-center justify-center hover:bg-red-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d4af37]"',
            '                    data-cart-action="remove" data-cart-id="' + escapeHtml(line.id) + '" aria-label="Remove ' + escapeHtml(line.name) + ' from cart">',
            '                ' + TRASH_ICON,
            '            </button>',
            '        </div>',
            '        <p class="text-xs text-[#1f271b]/70 font-semibold mt-1.5">' + escapeHtml(unitLabel) + '</p>',
            warning,
            '        <div class="flex items-center justify-between gap-3 mt-3">',
            '            ' + stepperHTML(line),
            lineTotal
                ? '            <span class="text-sm font-bold text-[#12170f]">' + escapeHtml(lineTotal) + '</span>'
                : '            <span class="text-[11px] text-[#1f271b]/40 font-semibold italic">On request</span>',
            '        </div>',
            '    </div>',
            '</div>'
        ].filter(entry => entry !== '').join('\n');
    }

    function emptyHTML() {
        return centredMessageHTML([
            '<div class="w-14 h-14 mx-auto mb-6 rounded-full bg-[#f1f5f9] flex items-center justify-center text-[#12170f]/30">',
            '    ' + BAG_ICON,
            '</div>',
            '<h3 class="text-lg font-bold tracking-tight text-[#12170f] mb-2">Your cart is empty</h3>',
            '<p class="text-sm text-[#1f271b]/60 mb-8">Browse the catalogue and add the machines, mouldings or spare parts you need.</p>',
            '<button type="button" id="cart-keep-shopping" class="' + SECONDARY_BUTTON_CLASSES + '">Keep Shopping</button>'
        ].join('\n'));
    }

    function loadingHTML() {
        return centredMessageHTML('<p class="text-[#1f271b]/50 font-semibold">Loading your cart…</p>');
    }

    function totalsHTML(totals) {
        const amount = window.formatAmount || (() => '');

        // The subtotal only ever counts what it could count, and says so. Most
        // rows in this catalogue carry no price, so silence here would read as
        // a total rather than as a partial one.
        const qualifier = totals.unpriced
            ? ' <span class="text-[10px] font-semibold text-[#1f271b]/50 normal-case tracking-normal">(' +
              totals.priced + ' of ' + totals.items + ' priced)</span>'
            : '';

        return [
            '<div class="flex items-baseline justify-between gap-4">',
            '    <span class="' + EYEBROW_CLASSES + ' text-[#1f271b]/50">Subtotal' + qualifier + '</span>',
            '    <span class="text-xl font-bold tracking-tight text-[#12170f]">' +
                 (totals.priced ? escapeHtml(amount(totals.amount)) : '<span class="text-sm font-semibold text-[#1f271b]/50 italic">On request</span>') +
            '</span>',
            '</div>',
            totals.unpriced
                ? '<p class="text-[11px] text-[#1f271b]/50 mt-1.5">' + totals.unpriced +
                  (totals.unpriced === 1 ? ' item is' : ' items are') +
                  ' priced on request and is not included above.</p>'
                : '',
            '<p class="text-[11px] text-[#1f271b]/50 mt-1.5">GST and delivery are calculated at checkout.</p>'
        ].filter(entry => entry !== '').join('\n');
    }

    function footerHTML(list) {
        if (!list.length) return '';

        const totals = totalsFor(list);

        return [
            '<div class="border-t border-[#12170f]/10 bg-white px-6 py-5">',
            '    ' + totalsHTML(totals),
            '    <div class="flex items-center gap-3 mt-5">',
            '        <button type="button" id="cart-clear" class="' + SECONDARY_BUTTON_CLASSES + '">Clear</button>',
            // An <a>, not a button with a handler: this is a navigation, so it
            // should middle-click, open in a new tab and show its target in the
            // status bar like any other link.
            '        <a href="/store/checkout.html" id="cart-checkout" class="' + PRIMARY_BUTTON_CLASSES + ' flex-1 text-sm px-4 py-3">Proceed to Checkout</a>',
            '    </div>',
            // Still not a dead end. Checkout cannot total a product priced "On
            // request", and most of this catalogue is — so the quote overlay is
            // the route for those, and is named here rather than found after a
            // refusal.
            totals.unpriced > 0
                ? '    <p class="text-[11px] text-[#1f271b]/50 mt-3 leading-relaxed">' + totals.unpriced + (totals.unpriced === 1 ? ' item is' : ' items are') + ' priced on request and cannot be checked out online. <button type="button" id="cart-to-quote" class="font-bold text-[#d4af37] hover:underline">Send these as a quote request</button> instead.</p>'
                : '    <p class="text-[11px] text-[#1f271b]/50 mt-3 leading-relaxed">Delivery and GST are worked out at the next step. Need bulk pricing or a formal quotation? <button type="button" id="cart-to-quote" class="font-bold text-[#d4af37] hover:underline">Send these as a quote request</button> instead.</p>',
            '</div>'
        ].join('\n');
    }

    // ------------------------------------------------------------------
    // DRAWER
    // ------------------------------------------------------------------
    // Every quantity change repaints the whole body, which would otherwise drop
    // focus to <body> mid-interaction — pressing "+" three times would work
    // once and then need the mouse. So the control being used is noted by its
    // data attributes and given focus again on the far side of the repaint.
    //
    // Attributes rather than the element itself, because the element is gone:
    // this is the same control, not the same node.
    function focusMemo() {
        const active = document.activeElement;
        if (!active || !handle || !handle.node.contains(active)) return null;

        const id = active.getAttribute && active.getAttribute('data-cart-id');
        if (!id) return null;

        return {
            id,
            action: active.getAttribute('data-cart-action'),
            isQuantity: active.hasAttribute('data-cart-qty')
        };
    }

    function restoreFocus(memo) {
        if (!memo || !handle) return;

        const selector = memo.isQuantity
            ? '[data-cart-qty][data-cart-id="' + memo.id + '"]'
            : '[data-cart-action="' + memo.action + '"][data-cart-id="' + memo.id + '"]';

        const target = handle.node.querySelector(selector);

        // A disabled twin cannot take focus — pressing "−" down to 1 disables
        // the button under the cursor — and a removed line has no twin at all.
        // Either way the nearest sensible landing is the panel's close button.
        if (target && !target.disabled) {
            target.focus({ preventScroll: true });
            return;
        }

        const fallback = handle.node.querySelector('#cart-close');
        if (fallback) fallback.focus({ preventScroll: true });
    }

    async function paint() {
        if (!handle) return;

        // Not the same as "empty". Until adopt() has settled, this browser
        // does not yet know whose cart it is holding, and drawing an empty
        // drawer at a signed-in customer — with a Clear button and a "browse
        // the catalogue" line — would be telling them something false.
        if (!settled) {
            handle.body.innerHTML = loadingHTML();
            handle.footerEl.innerHTML = '';
            return;
        }

        const memo = focusMemo();
        const list = await resolved();

        // The drawer may have been closed while the catalogue was in flight.
        if (!handle || !handle.node.isConnected) return;

        if (!list.length) {
            handle.body.innerHTML = emptyHTML();
            handle.footerEl.innerHTML = '';

            const keep = handle.node.querySelector('#cart-keep-shopping');
            if (keep) {
                keep.addEventListener('click', close);
                if (memo) keep.focus({ preventScroll: true });
            }
            return;
        }

        handle.body.innerHTML = '<div class="px-6">' + list.map(lineHTML).join('\n') + '</div>';
        handle.footerEl.innerHTML = footerHTML(list);

        chrome.enhance(handle.node);
        restoreFocus(memo);
    }

    function open() {
        if (handle) return;

        ensureStyles(STYLE_ID, CSS);

        handle = chrome.openDrawer({
            id: 'cart-drawer',
            titleId: 'cart-drawer-title',
            closeId: 'cart-close',
            header: chrome.drawerHeaderHTML({
                titleId: 'cart-drawer-title',
                title: 'Your Cart',
                closeId: 'cart-close',
                closeLabel: 'Close cart'
            }),
            onClose: () => {
                handle = null;
            }
        });

        handle.body.innerHTML = loadingHTML();
        wireDrawer(handle.node);

        // A cart whose account read failed — the server was unreachable when
        // the session landed — gets another go here, rather than staying a
        // detached local cart for the rest of the visit. Unconditional because
        // adopt() already returns immediately when there is nothing to do, and
        // one place deciding that beats two.
        adopt();

        paint();
        const firstControl = handle.node.querySelector('#cart-close');
        if (firstControl) firstControl.focus({ preventScroll: true });
    }

    function close() {
        if (handle) handle.close();
    }

    // One listener per drawer rather than per control: paint() replaces the
    // whole body on every quantity change, so anything bound to a row would be
    // thrown away the moment it was used.
    function wireDrawer(node) {
        node.addEventListener('click', (event) => {
            const target = event.target.closest('[data-cart-action], #cart-clear, #cart-to-quote');
            if (!target) return;

            if (target.id === 'cart-clear') {
                clear();
                return;
            }

            if (target.id === 'cart-to-quote') {
                // Captured before close(), which clears this module's view of
                // the drawer, and kept in both places on purpose: the global
                // for the in-page open() below, and sessionStorage for the
                // navigation taken when there is no quote form on this page.
                const carried = lines.map(line => ({
                    product_id: line.id,
                    id: line.id,
                    quantity: line.quantity
                }));

                window.srkPendingQuoteItems = carried;
                if (window.storeOverlay && window.storeOverlay.pendingQuote) {
                    window.storeOverlay.pendingQuote.put(carried);
                }

                close();

                if (window.requestQuote) {
                    window.requestQuote.open({ items: carried });
                    return;
                }

                // THE DRAWER IS ON CHECKOUT.HTML TOO, and that page does not
                // load request-quote-module.js. This guard used to be the end
                // of the branch, so the button there closed the drawer and did
                // nothing else — a dead control on a live screen. The basket is
                // already stored above, so sending the customer to the page
                // that does have the form finishes what the button promises.
                window.location.href = '/store/store.html#quote';
                return;
            }

            const id = target.getAttribute('data-cart-id');
            const action = target.getAttribute('data-cart-action');
            const line = find(id);
            if (!line) return;

            if (action === 'increase') setQuantity(id, line.quantity + 1);
            else if (action === 'decrease') setQuantity(id, line.quantity - 1);
            else if (action === 'remove') remove(id);
        });

        // Committed on blur and on Enter rather than on every keystroke: typing
        // "12" would otherwise be read as a 1 first, and re-rendering under the
        // cursor loses the caret.
        node.addEventListener('change', (event) => {
            const field = event.target.closest('[data-cart-qty]');
            if (!field) return;

            setQuantity(field.getAttribute('data-cart-id'), field.value);
        });

        node.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;

            const field = event.target.closest('[data-cart-qty]');
            if (!field) return;

            event.preventDefault();
            setQuantity(field.getAttribute('data-cart-id'), field.value);
        });
    }

    // ------------------------------------------------------------------
    // CARD WIRING
    // ------------------------------------------------------------------
    // Swaps the button's glyph for a tick so an add that does not open the
    // drawer still says it happened. Guarded on isConnected because the card
    // may be replaced by a section change before the timer fires.
    function confirmOn(button) {
        if (button.dataset.cartConfirming === 'true') {
            window.clearTimeout(Number(button.dataset.cartConfirmTimer));
        } else {
            button.dataset.cartMarkup = button.innerHTML;
        }

        button.dataset.cartConfirming = 'true';
        button.innerHTML = chrome.icon('M5 13l4 4L19 7');

        const timer = window.setTimeout(() => {
            if (!button.isConnected) return;
            button.innerHTML = button.dataset.cartMarkup || '';
            delete button.dataset.cartConfirming;
            delete button.dataset.cartMarkup;
        }, CONFIRM_MS);

        button.dataset.cartConfirmTimer = String(timer);
    }

    function attach() {
        // Capture at the document so a card rendered after this runs is still
        // covered, and so the card's own click handling cannot swallow it.
        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!target || !target.closest) return;

            const headerButton = target.closest('#cart-button');
            if (headerButton) {
                event.preventDefault();
                open();
                return;
            }

            const card = target.closest('article[data-product-id]');
            if (!card) return;

            const addButton = target.closest('.cart-icon-btn');
            const buyButton = target.closest('.buy-now-btn');
            if (!addButton && !buyButton) return;

            event.preventDefault();
            event.stopPropagation();

            const productId = card.getAttribute('data-product-id');

            add(productId).then(async added => {
                if (!added) return;

                bumpBadge();

                // "Buy Now" is the whole intent, so it continues to checkout.
                // The small icon is a quiet add, and interrupting a browse with
                // a drawer would be the wrong trade.
                if (buyButton) {
                    await flushPendingWrite();
                    window.location.assign('/store/checkout.html');
                }
                else if (addButton) confirmOn(addButton);
            });
        }, true);

        // The badge is styled by CSS this module injects, and until now that
        // injection only happened in open() — so a visitor arriving with items
        // already in their cart got an unstyled <span> sitting inline next to
        // the glyph, shoving it off-centre, until they happened to open the
        // drawer. Inject it here instead, where the badge first appears.
        // ensureStyles is idempotent, so open()'s call is now a harmless
        // no-op and is kept for the case where attach() never ran.
        ensureStyles(STYLE_ID, CSS);
        refreshBadge();
    }

    // ------------------------------------------------------------------
    // STARTUP
    // ------------------------------------------------------------------
    // Synchronous, and deliberately so: the badge paints from this before any
    // round trip, so a guest never watches their own cart appear. A signed-in
    // customer's real cart arrives a moment later and replaces it, which is
    // the one order these two can go in — the alternative is showing nothing
    // to everybody for the sake of the smaller group.
    lines = mergeLines(readGuest(), adoptLegacyCart());

    listeners.push(refreshBadge);
    listeners.push(() => { if (handle) paint(); });

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
    else attach();

    // `ready` resolves once this browser knows whose cart it is holding —
    // which is not the same as holding it successfully. An account read that
    // failed still resolves it, with `ownerId` null and the lines it had; the
    // promise answers "has the question been settled", and anything waiting on
    // it wants to stop waiting either way.
    //
    // store/checkout.html is the caller that makes this necessary rather than
    // merely tidy: checkout-module.js reads cart.items() as its first act, and
    // for a signed-in customer that would be an empty basket and an "your cart
    // is empty" screen painted over a real order.
    let settle;
    const ready = new Promise(resolve => { settle = resolve; });

    if (account) {
        // account.ready is the promise for the first GET /api/auth/me. Acting
        // before it lands reads a signed-in customer as a guest — the same
        // reason profile-icon-loader.js awaits it before routing.
        Promise.resolve(account.ready)
            .then(adopt, adopt)          // a failed session read is still an answer: guest
            .then(settle, settle);

        if (typeof account.subscribe === 'function') {
            account.subscribe(() => { adopt(); });
        }
    } else {
        // No session module on this page, so there is nobody to be and
        // nothing to wait for.
        settled = true;
        settle();
    }

    // A debounced write still pending when the page goes away — clicking
    // through to checkout inside the 400ms window is the ordinary way that
    // happens. `pagehide` rather than `unload`: unload disqualifies a page
    // from the back/forward cache and does not fire at all on mobile Safari.
    // visibilitychange covers the tab being backgrounded and then discarded,
    // which on mobile is how most pages actually end.
    window.addEventListener('pagehide', flushPendingWrite);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushPendingWrite();
    });

    window.storeCart = {
        add,
        setQuantity,
        remove,
        clear,
        find,
        count,
        items: () => lines.map(line => Object.assign({}, line)),
        totals: () => totalsFor(lines),
        flush: flushPendingWrite,
        open,
        close,
        subscribe: (fn) => { if (typeof fn === 'function') listeners.push(fn); },

        ready,
        // Whether these lines are being saved to an account. False for a
        // guest, and also for a signed-in customer whose cart could not be
        // read — worth being able to ask rather than inferring it from a
        // count that looks the same either way.
        isAccountCart: () => ownerId !== null
    };
})();
