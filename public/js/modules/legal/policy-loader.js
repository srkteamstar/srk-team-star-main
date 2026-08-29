document.addEventListener("DOMContentLoaded", () => {
    const contentArea = document.getElementById("policy-content");
    const navButtons = document.querySelectorAll(".nav-btn");
    const activeProgress = document.getElementById("active-progress");
    const policyRoutes = {
        home: { path: '/legal/home.html', title: 'Legal & Business Details - SRK Team Star' },
        privacy: { path: '/legal/privacy-policy.html', title: 'Privacy Policy - SRK Team Star' },
        terms: { path: '/legal/terms-of-service.html', title: 'Terms of Service - SRK Team Star' },
        shipping: { path: '/legal/shipping-policy.html', title: 'Shipping Policy - SRK Team Star' },
        return: { path: '/legal/return-policy.html', title: 'Return Policy - SRK Team Star' },
        support: { path: '/legal/support-policy.html', title: 'Support - SRK Team Star' }
    };

    // ------------------------------------------------------------------
    // POLICY TEMPLATES & DATA
    // ------------------------------------------------------------------
    const heading = title => `<h1 class="text-3xl font-extrabold mb-8 text-[#12170F] border-b border-[#420C14]/20 pb-4">${title}</h1>`;
    const contactBlock = `<strong>Email:</strong> srkteamstar@gmail.com<br><strong>Phone:</strong> +91 90500 09442<br><strong>Address:</strong> Behind New ITI, Rohtak Road, Near Water Boosting Station, Gohana, Sonipat, Haryana 131301, India.`;

    const policyTemplates = {
        home: `
            ${heading('Business Details')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed space-y-6">
                <p>SRK Team Star publishes the following details so customers and business partners can identify the enterprise. These details are supplied by the business and should be checked against the relevant government register when independent verification is required.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                    <div class="bg-[#F1F5F9] p-6 rounded-lg border border-[#420C14]/10"><h2 class="text-xl font-bold text-[#12170F]">GST registration</h2><p class="mt-3"><strong>GSTIN:</strong> 06DOCPR1264G1Z0<br><strong>Legal name:</strong> POOJA RANI<br><strong>Trade name:</strong> SRK TEAM STAR<br><strong>Registration date:</strong> 08-Mar-2026</p></div>
                    <div class="bg-[#F1F5F9] p-6 rounded-lg border border-[#420C14]/10"><h2 class="text-xl font-bold text-[#12170F]">Import Export Code</h2><p class="mt-3"><strong>IEC:</strong> DOCPR1264G<br><strong>Authority:</strong> Directorate General of Foreign Trade</p></div>
                    <div class="bg-[#F1F5F9] p-6 rounded-lg border border-[#420C14]/10"><h2 class="text-xl font-bold text-[#12170F]">Udyam registration</h2><p class="mt-3"><strong>Udyam number:</strong> UDYAM-HR-18-0040767<br><strong>Enterprise type supplied:</strong> Micro Enterprise</p></div>
                    <div class="bg-[#F1F5F9] p-6 rounded-lg border border-[#420C14]/10"><h2 class="text-xl font-bold text-[#12170F]">Business address</h2><p class="mt-3">Behind New ITI, Rohtak Road<br>Near Water Busting Station, Gohana, Sonipat<br>Haryana 131301, India</p></div>
                </div>
                <p>Registration details do not by themselves certify a product, transaction, audit, or trading partner. Product specifications, pricing, export terms and compliance documents are confirmed for the particular quotation or order.</p>
            </section>`,

        privacy: `
            ${heading('Privacy Policy')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed">
                <p class="mb-6">This policy explains the personal data SRK Team Star uses when you browse the site, create an account, request a quote, send an enquiry, place an order, or contact support.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Information we collect</h2>
                <ul class="list-disc pl-6 mb-6 space-y-2"><li>Contact, business, billing and delivery details you provide.</li><li>The registered email or phone identifier used for customer access and a one-way password hash; administrators use an authenticator code.</li><li>Cart, quote, enquiry, order, delivery and payment-status records.</li><li>Session, IP address and security logs needed to operate and protect the service.</li></ul>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">How we use and share data</h2>
                <p class="mb-6">We use data to provide the requested service, fulfil and support orders, prevent abuse, keep business and tax records, and comply with law. We share only what is reasonably needed with hosting and database providers, Razorpay when online payment is selected, delivery providers, professional advisers, and public authorities where legally required. We do not sell personal data.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Payments, retention and security</h2>
                <p class="mb-6">Payment-card details are entered in Razorpay's payment interface and are not stored by this website. We retain records for as long as needed for the service, security, disputes, warranties, tax and other legal obligations. We use password-protected customer accounts, scoped sessions, rate limits and restricted TOTP-protected administrative access, but no internet service can promise absolute security. Passwords are processed on the server and stored only as salted one-way hashes.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Your choices and requests</h2>
                <p class="mb-6">Subject to applicable law, you may ask for access, correction, erasure, withdrawal of consent where processing is consent-based, or grievance handling. Some order and tax records may need to be retained even after an account is closed. Contact us using: <br><br>${contactBlock}</p>
            </section>`,

        terms: `
            ${heading('Terms of Service')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed">
                <p class="mb-6">These terms govern use of the SRK Team Star website and purchases made through it. Nothing in them excludes a right or remedy that cannot lawfully be excluded.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Accounts and acceptable use</h2><p class="mb-6">Provide accurate information, keep your account password confidential, keep control of the registered email address or phone number, and tell us promptly about suspected unauthorised use. Do not misuse the site, attempt unauthorised access, disrupt security, submit unlawful material, or infringe another person's rights.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Products, quotations and orders</h2><p class="mb-6">A quote request is not an accepted order. Product availability, specifications, delivery terms and any price shown as “On request” are confirmed separately. An order is accepted when we confirm it. If a material catalogue or pricing error affects an order, we will contact you and provide the options required by applicable law, including a refund where appropriate.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Intellectual property</h2><p class="mb-6">Site content, branding and photographs belong to SRK Team Star or their respective licensors. You may use the site for evaluating and purchasing products, but may not republish or exploit protected material without permission or another lawful basis.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Liability and governing law</h2><p class="mb-6">Each party remains responsible to the extent required by applicable law. We do not exclude liability that cannot lawfully be excluded, including statutory consumer remedies where they apply. These terms are governed by Indian law, and any jurisdiction provision is subject to mandatory consumer and procedural law.</p>
            </section>`,

        shipping: `
            ${heading('Shipping & Fulfilment Policy')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed">
                <p class="mb-6">GST is charged at 18%. Delivery is free for purchases of ₹50,000 or more. Below that threshold, the delivery charge is confirmed with the order and collected at the point of delivery rather than included in the website payment. A quotation may be required for machinery, bulk and export orders.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Processing and delivery estimates</h2><p class="mb-6">We confirm dispatch or production timing for the particular order. Any date or transit window we provide is an estimate unless the order confirmation expressly says it is guaranteed. We will communicate material delays and the options available under applicable law.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Domestic and international delivery</h2><p class="mb-6">Domestic orders are sent using a suitable carrier for the goods and destination. International orders are accepted only after destination, documentation, freight, duties and delivery responsibilities are agreed. Customs charges and importer responsibilities will be identified in the quotation or agreed trade terms rather than assumed by this policy.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Tracking, loss and damage</h2><p class="mb-6">Tracking or dispatch details are provided when available. Inspect the shipment promptly and contact us as soon as reasonably possible about loss, damage, shortage or a wrong item. Photographs and packaging can help us investigate, but an arbitrary reporting deadline does not remove rights that apply by law.</p>
            </section>`,

        return: `
            ${heading('Returns & Refund Policy')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed">
                <p class="mb-6">Contact us promptly if goods are damaged, defective, deficient, spurious, materially different from their description or order, or delivered later than agreed other than because of force majeure. We will assess the appropriate repair, replacement, return, exchange or refund in line with the order terms and applicable law.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">How to request help</h2><p class="mb-6">Email <strong>srkteamstar@gmail.com</strong> or call <strong>+91 90500 09442</strong> with the order reference and a description of the issue. Keep the goods and packaging where reasonably possible while we provide return or inspection instructions. Photographs may speed up assessment.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Change-of-mind and customised goods</h2><p class="mb-6">A change-of-mind return is available only where it is stated in the quotation or order confirmation. Custom-made, configured, installed or used industrial goods may not be suitable for change-of-mind return. These limits do not override remedies for defective, deficient, spurious, incorrectly supplied or misdescribed goods.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Costs and refunds</h2><p class="mb-6">We will explain return transport responsibility before collection or dispatch. Where the return results from our error or a legally protected product problem, we will not impose costs contrary to applicable law. Approved refunds are sent to the original payment route where practical; bank or payment-provider processing time may follow. Shipping and payment charges are refunded where the contract or applicable law requires it.</p>
            </section>`,

        support: `
            ${heading('Customer Support & Grievances')}
            <section class="max-w-4xl text-[#1F271B] text-base leading-relaxed">
                <p class="mb-6">Use the channels below for product questions, quotations, order support, privacy requests and complaints. Include an order, quote or enquiry reference where available so the team can trace the matter.</p>
                <div class="bg-[#F1F5F9] p-8 rounded-lg border border-[#420C14]/10 mb-8"><h2 class="text-xl font-bold mb-4 text-[#12170F]">Contact and grievance channel</h2><p>${contactBlock}</p></div>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Escalation</h2><p class="mb-6">If the first response does not resolve the issue, reply on the same email thread or quote the original reference by phone and ask for escalation. Complaints and grievances are acknowledged and handled within the timelines required by applicable law.</p>
                <h2 class="text-xl font-bold mt-8 mb-3 text-[#12170F]">Returns and legal notices</h2><p class="mb-6">Do not send goods until return instructions are provided. Written correspondence may be sent to the address above.</p>
            </section>`
    };

    // ------------------------------------------------------------------
    // DYNAMIC IF-ELSE LADDER POLICY LOADER
    // ------------------------------------------------------------------
    function loadPolicyContent(policyType) {
        
        // 1. Temporarily strip the animation classes and hide the container 
        // to prepare for the smooth "Scroll Reveal" effect.
        if (contentArea) {
            contentArea.classList.remove('transition-all', 'duration-[1000ms]', 'ease-out');
            contentArea.classList.add('opacity-0', '-translate-y-6');

            // IF-ELSE LADDER TO DETERMINE POLICY TO LOAD
            if (policyType === "home") {
                contentArea.innerHTML = policyTemplates.home;
            } else if (policyType === "privacy") {
                contentArea.innerHTML = policyTemplates.privacy;
            } else if (policyType === "terms") {
                contentArea.innerHTML = policyTemplates.terms;
            } else if (policyType === "shipping") {
                contentArea.innerHTML = policyTemplates.shipping;
            } else if (policyType === "return") {
                contentArea.innerHTML = policyTemplates.return;
            } else if (policyType === "support") {
                contentArea.innerHTML = policyTemplates.support;
            } else {
                contentArea.innerHTML = policyTemplates.home;
            }

            // --------------------------------------------------------------
            // Explicitly force scroll position to the top of the viewport
            // using 'smooth' behavior so it flows nicely instead of snapping.
            // --------------------------------------------------------------
            window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });

            // 2. Force a browser reflow so it registers the hidden state
            // before we re-add the transition classes.
            void contentArea.offsetWidth;

            // 3. Re-apply the transition classes and trigger the fade-in/slide-up
            contentArea.classList.add('transition-all', 'duration-[1000ms]', 'ease-out');
            contentArea.classList.remove('opacity-0', '-translate-y-6');
            
            // Recalculate progress bar height for the newly loaded content
            updateProgress();
        }
    }

    // ------------------------------------------------------------------
    // LINK STATE & PROGRESS BAR MOVER
    // ------------------------------------------------------------------
    function setActiveLink(clickedBtn) {
        navButtons.forEach(btn => {
            btn.classList.remove("text-[#D4AF37]", "font-semibold");
            btn.classList.add("hover:text-[#d4af37]");
        });

        clickedBtn.classList.add("text-[#D4AF37]", "font-semibold");
        clickedBtn.classList.remove("hover:text-[#d4af37]");

        // Append active progress bar element to the current active <li>
        const parentLi = clickedBtn.parentElement;
        if (parentLi && activeProgress) {
            parentLi.appendChild(activeProgress);
        }
    }

    // ------------------------------------------------------------------
    // EVENT DELEGATION & PREVENT DEFAULT (THE CRITICAL UPDATE)
    // ------------------------------------------------------------------
    navButtons.forEach(button => {
        button.addEventListener("click", (e) => {
            e.preventDefault(); // Prevents the <a> tag from reloading the page or jumping
            const policyKey = e.currentTarget.getAttribute("data-policy");
            setActiveLink(e.currentTarget);
            loadPolicyContent(policyKey);
            const route = policyRoutes[policyKey];
            if (route && window.location.pathname !== route.path) {
                window.history.pushState({ policy: policyKey }, '', route.path);
            }
            if (route) document.title = route.title;
        });
    });

    window.addEventListener('popstate', () => {
        const entry = Object.entries(policyRoutes).find(([, route]) => route.path === window.location.pathname);
        const key = entry ? entry[0] : 'home';
        const button = document.querySelector(`.nav-btn[data-policy="${key}"]`);
        if (button) setActiveLink(button);
        loadPolicyContent(key);
        if (policyRoutes[key]) document.title = policyRoutes[key].title;
    });

    // ------------------------------------------------------------------
    // SCROLL PROGRESS CALCULATION
    // ------------------------------------------------------------------
    function updateProgress() {
        if (!activeProgress || !contentArea) return;

        const scrollPosition = window.scrollY;
        const contentHeight = contentArea.scrollHeight;
        const windowHeight = window.innerHeight;
        const scrollableDistance = contentHeight - windowHeight + contentArea.offsetTop;

        let scrollPercentage = 0;
        if (scrollableDistance > 0) {
            scrollPercentage = (scrollPosition / scrollableDistance) * 100;
        }

        scrollPercentage = Math.max(0, Math.min(100, scrollPercentage));
        activeProgress.style.height = `${scrollPercentage}%`;
    }

    // Global scroll listener
    window.addEventListener("scroll", updateProgress, { passive: true });

    // ------------------------------------------------------------------
    // INITIAL LOAD WITH UNIQUE IDENTIFIER DETECTION
    // ------------------------------------------------------------------
    // 1. Get the unique identifier from the body tag (defaults to "home" if missing)
    const defaultPolicyId = document.body.getAttribute('data-active-policy') || 'home';

    // 2. Find the corresponding sidebar button
    const initialBtn = document.querySelector(`.nav-btn[data-policy="${defaultPolicyId}"]`);

    // 3. If found, visually set it as active (moves the gold styling and progress bar)
    // This strips the hardcoded HTML active class off the "Home" button if needed.
    if (initialBtn) {
        setActiveLink(initialBtn);
    }

    // 4. Finally, load the appropriate content based on the identifier
    loadPolicyContent(defaultPolicyId);
});
