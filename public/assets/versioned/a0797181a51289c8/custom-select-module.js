/**
 * custom-select-module.js
 *
 * Replaces the browser's native dropdown popup with one that matches the rest of
 * the site. The list a native <select> opens is drawn by the operating system —
 * its blue highlight, font and padding cannot be reached by CSS — so the only way
 * to style it is to render our own.
 *
 * How it works, and why it is safe to drop in:
 *
 *   - The real <select> stays in the DOM as the source of truth. It is hidden,
 *     never removed, so `document.getElementById('input-prod-category').value`
 *     and every existing save handler keep working untouched.
 *   - Choosing an option writes to the select and dispatches a real `change`
 *     event, so inline handlers like enquiries.js's
 *     `onchange="updateTicketStatus(this.value)"` still fire.
 *   - The visible trigger copies the select's own classes, so each dropdown keeps
 *     the shape it already had — pill-shaped sorters on the storefront, square
 *     fields elsewhere — without this file knowing about either.
 *   - The panel renders in a fixed layer attached to <body>. Inside a
 *     drawer (`overflow-y: auto`) an absolutely positioned panel would be clipped
 *     at the container edge; fixed positioning escapes that, and the panel flips
 *     above the trigger when there is no room below.
 *   - A MutationObserver picks up selects injected later, which is all of them —
 *     the drawers and section loaders stringify their HTML at render time.
 *
 * Palette is the existing one: white surface, hairline #12170f/10 border, the
 * same shadow and radius as the row action dropdowns, #f8fafc hover, and the
 * #d4af37 gold for the selected row in place of the OS blue.
 */
(function () {
    'use strict';

    if (window.__srkCustomSelectLoaded) return;
    window.__srkCustomSelectLoaded = true;

    var STYLE_ID = 'srk-custom-select-styles';
    var nextId = 0;

    var CSS = [
        /* Layout-transparent wrapper: the trigger lands exactly where the select */
        /* sat, so flex rows and w-full fields both keep their geometry.          */
        '.srk-select{display:contents;}',

        '.srk-select__native{position:absolute!important;width:1px!important;height:1px!important;',
        'padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;',
        'white-space:nowrap!important;border:0!important;}',

        '.srk-select__trigger{display:inline-flex;align-items:center;justify-content:space-between;',
        'gap:8px;text-align:left;cursor:pointer;font-family:inherit;}',
        '.srk-select__trigger:disabled{cursor:not-allowed;opacity:.55;}',
        /* Only selects that had no chevron of their own get one. */
        '.srk-select__trigger--chevron{padding-right:2.25rem!important;position:relative;}',
        '.srk-select__chevron{position:absolute;right:.85rem;top:50%;transform:translateY(-50%);',
        'width:1rem;height:1rem;opacity:.45;pointer-events:none;transition:transform .18s ease;}',
        '.srk-select__trigger[aria-expanded="true"] .srk-select__chevron{transform:translateY(-50%) rotate(180deg);}',

        '.srk-select__label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1 1 auto;}',
        '.srk-select__label--placeholder{color:#5c6456;opacity:1;}',

        '.srk-select__panel{position:fixed;z-index:2147483000;background:#ffffff;',
        'border:1px solid rgba(18,23,15,.10);border-radius:2px;',
        'box-shadow:0 12px 20px -6px rgba(18,23,15,.18),0 4px 8px -4px rgba(18,23,15,.10);',
        'padding:4px;max-height:16rem;overflow-y:auto;overscroll-behavior:contain;',
        'font-family:inherit;opacity:0;transform:translateY(-4px);transition:opacity .13s ease,transform .13s ease;}',
        '.srk-select__panel.is-open{opacity:1;transform:translateY(0);}',

        '.srk-select__option{display:flex;align-items:center;justify-content:space-between;gap:10px;',
        'width:100%;text-align:left;padding:9px 12px;border:0;background:transparent;border-radius:2px;',
        'font-family:inherit;font-size:13.5px;font-weight:600;line-height:1.35;color:#1f271b;cursor:pointer;',
        'transition:background-color .12s ease,color .12s ease;}',
        '.srk-select__option:hover,.srk-select__option.is-active{background:#f8fafc;color:#12170f;}',
        '.srk-select__option.is-selected{background:rgba(212,175,55,.13);color:#705714;}',
        '.srk-select__option.is-selected:hover,.srk-select__option.is-selected.is-active{background:rgba(212,175,55,.22);}',
        '.srk-select__option[disabled]{opacity:.4;cursor:not-allowed;}',
        '.srk-select__option:focus{outline:none;}',

        '.srk-select__check{width:14px;height:14px;flex:none;opacity:0;}',
        '.srk-select__option.is-selected .srk-select__check{opacity:1;}',

        '@media (prefers-reduced-motion:reduce){',
        '.srk-select__panel{transition:none;}.srk-select__chevron{transition:none;}}'
    ].join('');

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    var CHEVRON_SVG = '<svg class="srk-select__chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';

    var CHECK_SVG = '<svg class="srk-select__check" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // The single panel currently on screen, if any.
    var open = null;

    // Hiding is applied as inline styles as well as a class, because existing code
    // legitimately rewrites a select's className to restyle it — enquiries.js does
    // exactly that when a ticket's status changes. A class alone would be wiped by
    // that assignment and the native select would pop back into view next to the
    // trigger. Inline styles survive a className overwrite, so there is no flash
    // before the observer below puts the class back.
    var HIDDEN_STYLES = {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        'white-space': 'nowrap',
        border: '0',
        opacity: '0',
        'pointer-events': 'none'
    };

    function hideNative(select) {
        select.classList.add('srk-select__native');
        Object.keys(HIDDEN_STYLES).forEach(function (property) {
            select.style.setProperty(property, HIDDEN_STYLES[property], 'important');
        });
    }

    // ---------------------------------------------------------------- label ---
    function syncLabel(select, labelEl) {
        var option = select.options[select.selectedIndex];
        var text = option ? option.textContent.trim() : '';

        labelEl.textContent = text || ' ';

        // An empty value reads as a placeholder ("Uncategorised", "None") — dim it
        // the way a real placeholder attribute would.
        var isPlaceholder = !!option && option.value === '' && select.selectedIndex === 0;
        labelEl.classList.toggle('srk-select__label--placeholder', isPlaceholder);
    }

    // ---------------------------------------------------------------- panel ---
    function positionPanel(panel, trigger) {
        var rect = trigger.getBoundingClientRect();
        var margin = 6;
        var panelHeight = panel.offsetHeight;
        var below = window.innerHeight - rect.bottom - margin;
        var above = rect.top - margin;

        // Flip above only when below genuinely cannot hold the panel and above
        // has more room — otherwise the list jumps around on short pages.
        var flip = panelHeight > below && above > below;

        panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)) + 'px';
        panel.style.minWidth = rect.width + 'px';
        panel.style.maxWidth = Math.max(rect.width, 320) + 'px';

        if (flip) {
            panel.style.top = Math.max(8, rect.top - panelHeight - margin) + 'px';
        } else {
            panel.style.top = (rect.bottom + margin) + 'px';
            panel.style.maxHeight = Math.max(120, below) + 'px';
        }
    }

    function closePanel() {
        if (!open) return;

        var state = open;
        open = null;

        state.trigger.setAttribute('aria-expanded', 'false');
        state.trigger.removeAttribute('aria-activedescendant');
        state.trigger.removeAttribute('aria-controls');
        state.panel.setAttribute('aria-hidden', 'true');
        state.panel.classList.remove('is-open');

        window.removeEventListener('scroll', state.reposition, true);
        window.removeEventListener('resize', state.reposition);

        var panel = state.panel;
        window.setTimeout(function () {
            if (panel.parentNode) panel.parentNode.removeChild(panel);
        }, 130);
    }

    function commit(select, value) {
        if (select.value === value) return;
        select.value = value;
        // A real event so inline onchange="…" handlers and listeners both fire.
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function openPanel(select, trigger, labelEl) {
        closePanel();

        var panel = document.createElement('div');
        panel.className = 'srk-select__panel';
        panel.setAttribute('role', 'listbox');
        panel.id = trigger.id + '-listbox';
        panel.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Options');
        if (trigger.getAttribute('aria-labelledby')) panel.setAttribute('aria-labelledby', trigger.getAttribute('aria-labelledby'));
        trigger.setAttribute('aria-controls', panel.id);

        // Built from the live select every time it opens, so options added after
        // enhancement (a category list that loaded late) are always current.
        var options = Array.prototype.slice.call(select.options);

        panel.innerHTML = options.map(function (option, index) {
            var selected = index === select.selectedIndex;
            return '<button type="button" role="option" tabindex="-1" id="' + panel.id + '-option-' + index + '" data-index="' + index + '"' +
                ' aria-selected="' + (selected ? 'true' : 'false') + '"' +
                (option.disabled ? ' disabled' : '') +
                ' class="srk-select__option' + (selected ? ' is-selected' : '') + '">' +
                '<span>' + escapeHtml(option.textContent.trim()) + '</span>' + CHECK_SVG +
                '</button>';
        }).join('');

        document.body.appendChild(panel);

        var state = {
            select: select,
            trigger: trigger,
            panel: panel,
            activeIndex: select.selectedIndex < 0 ? 0 : select.selectedIndex,
            reposition: function () {
                // The drawer can be re-rendered or closed while a panel is open,
                // which would otherwise leave it floating over an element that no
                // longer exists.
                if (!document.contains(trigger)) return closePanel();
                positionPanel(panel, trigger);
            }
        };
        open = state;

        positionPanel(panel, trigger);
        // Next frame, so the opening transition actually runs.
        window.requestAnimationFrame(function () { panel.classList.add('is-open'); });

        trigger.setAttribute('aria-expanded', 'true');
        window.addEventListener('scroll', state.reposition, true);
        window.addEventListener('resize', state.reposition);

        setActive(state, state.activeIndex, false);

        panel.addEventListener('mousedown', function (event) { event.preventDefault(); });
        panel.addEventListener('click', function (event) {
            var button = event.target.closest('.srk-select__option');
            if (!button || button.disabled) return;

            commit(select, options[Number(button.dataset.index)].value);
            syncLabel(select, labelEl);
            closePanel();
            trigger.focus();
        });

        var selectedButton = panel.querySelector('.srk-select__option.is-selected');
        if (selectedButton) selectedButton.scrollIntoView({ block: 'nearest' });

        return state;
    }

    function setActive(state, index, scroll) {
        var buttons = state.panel.querySelectorAll('.srk-select__option');
        if (!buttons.length) return;

        var next = Math.max(0, Math.min(index, buttons.length - 1));
        state.activeIndex = next;

        for (var i = 0; i < buttons.length; i++) {
            buttons[i].classList.toggle('is-active', i === next);
        }
        state.trigger.setAttribute('aria-activedescendant', buttons[next].id);
        if (scroll !== false) buttons[next].scrollIntoView({ block: 'nearest' });
    }

    function moveActive(state, delta) {
        var buttons = state.panel.querySelectorAll('.srk-select__option');
        var index = state.activeIndex;

        // Step over disabled options rather than landing on them.
        for (var step = 0; step < buttons.length; step++) {
            index += delta;
            if (index < 0) index = buttons.length - 1;
            if (index > buttons.length - 1) index = 0;
            if (!buttons[index].disabled) break;
        }
        setActive(state, index);
    }

    // -------------------------------------------------------------- enhance ---
    function enhance(select) {
        if (!select || select.dataset.srkEnhanced === 'true') return;
        if (select.multiple || select.size > 1) return;
        if (select.closest('.srk-select')) return;

        select.dataset.srkEnhanced = 'true';

        var wrapper = document.createElement('div');
        wrapper.className = 'srk-select';

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = 'srk-combobox-' + (++nextId);
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (select.disabled) trigger.disabled = true;

        function syncAccessibility() {
            var ariaLabel = select.getAttribute('aria-label');
            var labelledby = select.getAttribute('aria-labelledby');
            if (!labelledby && select.labels && select.labels.length) {
                labelledby = Array.prototype.map.call(select.labels, function (label, index) {
                    if (!label.id) label.id = trigger.id + '-label-' + index;
                    if (!label.dataset.srkSelectLabel) {
                        label.dataset.srkSelectLabel = 'true';
                        label.addEventListener('click', function (event) { event.preventDefault(); trigger.focus(); });
                    }
                    return label.id;
                }).join(' ');
            }
            if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
            else trigger.removeAttribute('aria-label');
            if (labelledby) trigger.setAttribute('aria-labelledby', labelledby);
            else trigger.removeAttribute('aria-labelledby');
            ['aria-describedby', 'aria-invalid', 'aria-errormessage'].forEach(function (key) {
                var value = select.getAttribute(key);
                if (value !== null) trigger.setAttribute(key, value);
                else trigger.removeAttribute(key);
            });
            trigger.setAttribute('aria-required', String(select.required || select.getAttribute('aria-required') === 'true'));
        }
        syncAccessibility();
        var observedAttributes = ['class', 'style', 'disabled', 'required', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid', 'aria-errormessage', 'aria-required'];

        // Several storefront selects already have a chevron drawn as an absolutely
        // positioned sibling. Adding another would double it up.
        var hasOwnChevron = !!(select.parentElement &&
            select.parentElement.querySelector(':scope > svg'));

        var labelEl = document.createElement('span');
        labelEl.className = 'srk-select__label';
        trigger.appendChild(labelEl);

        if (!hasOwnChevron) trigger.insertAdjacentHTML('beforeend', CHEVRON_SVG);

        // Mirrors the select's classes onto the visible trigger. Inheriting them is
        // what lets one module serve the pill-shaped storefront sorters and the
        // square fields alike — and re-running it is how a status
        // badge picks up its new colour when the ticket state changes.
        function syncTriggerClasses() {
            var classes = select.className.split(/\s+/).filter(function (name) {
                return name && name !== 'srk-select__native';
            });

            classes.push('srk-select__trigger');
            if (!hasOwnChevron) classes.push('srk-select__trigger--chevron');

            trigger.className = classes.join(' ');
        }

        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(trigger);
        wrapper.appendChild(select);

        select.setAttribute('tabindex', '-1');
        select.setAttribute('aria-hidden', 'true');

        hideNative(select);
        syncTriggerClasses();
        syncLabel(select, labelEl);

        // Existing code restyles selects by assigning to className, and sets the
        // value directly. Watching the attributes keeps the trigger in step and
        // re-applies the hiding class, so neither can resurrect the native list.
        var attrObserver = new MutationObserver(function () {
            attrObserver.disconnect();

            hideNative(select);
            syncTriggerClasses();
            syncLabel(select, labelEl);
            trigger.disabled = select.disabled;
            syncAccessibility();

            attrObserver.observe(select, {
                attributes: true,
                attributeFilter: observedAttributes
            });
        });

        attrObserver.observe(select, {
            attributes: true,
            attributeFilter: observedAttributes
        });

        // `.value = …` is a property, not an attribute, so no observer sees it.
        // enquiries.js assigns it directly without dispatching change, which would
        // otherwise leave the trigger showing the previous status. Wrapping the
        // accessors on this element makes every assignment anywhere in the
        // codebase repaint the label.
        var descriptors = {
            value: Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value'),
            selectedIndex: Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'selectedIndex')
        };

        Object.keys(descriptors).forEach(function (property) {
            var descriptor = descriptors[property];
            if (!descriptor || !descriptor.set) return;

            Object.defineProperty(select, property, {
                configurable: true,
                enumerable: descriptor.enumerable,
                get: function () { return descriptor.get.call(this); },
                set: function (next) {
                    descriptor.set.call(this, next);
                    syncLabel(select, labelEl);
                }
            });
        });

        // Covers the user picking from our own panel, and any code that does
        // dispatch a change event.
        select.addEventListener('change', function () { syncLabel(select, labelEl); });

        trigger.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            if (open && open.trigger === trigger) closePanel();
            else openPanel(select, trigger, labelEl);
        });

        trigger.addEventListener('keydown', function (event) {
            var key = event.key;
            var state = (open && open.trigger === trigger) ? open : null;

            if (!state) {
                if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
                    event.preventDefault();
                    openPanel(select, trigger, labelEl);
                }
                return;
            }

            if (key === 'ArrowDown') { event.preventDefault(); moveActive(state, 1); }
            else if (key === 'ArrowUp') { event.preventDefault(); moveActive(state, -1); }
            else if (key === 'Home') { event.preventDefault(); setActive(state, 0); }
            else if (key === 'End') { event.preventDefault(); setActive(state, select.options.length - 1); }
            else if (key === 'Escape') { event.preventDefault(); closePanel(); }
            else if (key === 'Tab') { closePanel(); }
            else if (key === 'Enter' || key === ' ') {
                event.preventDefault();
                var option = select.options[state.activeIndex];
                if (option && !option.disabled) {
                    commit(select, option.value);
                    syncLabel(select, labelEl);
                }
                closePanel();
            }
        });
    }

    function enhanceAll(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var selects = scope.querySelectorAll('select:not([data-srk-enhanced])');
        for (var i = 0; i < selects.length; i++) enhance(selects[i]);
    }

    // Exposed so a page can force a pass after injecting markup, though the
    // observer below normally handles it.
    window.enhanceCustomSelects = enhanceAll;

    function start() {
        injectStyles();
        enhanceAll(document);

        // The drawers and section loaders stringify their HTML at render time, so
        // most selects on this site do not exist at load.
        new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var node = added[j];
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'SELECT') enhance(node);
                    else if (node.querySelectorAll) enhanceAll(node);
                }
            }

            // Drop an open panel whose trigger was just torn out from under it —
            // closing a drawer replaces its whole innerHTML.
            if (open && !document.contains(open.trigger)) closePanel();
        }).observe(document.documentElement, { childList: true, subtree: true });

        document.addEventListener('click', function (event) {
            if (!open) return;
            if (event.target.closest('.srk-select__panel')) return;
            if (event.target.closest('.srk-select__trigger') === open.trigger) return;
            closePanel();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') closePanel();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
