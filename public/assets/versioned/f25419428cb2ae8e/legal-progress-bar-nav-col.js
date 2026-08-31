document.addEventListener("DOMContentLoaded", () => {
    const policyContent = document.getElementById("policy-content");
    const activeProgress = document.getElementById("active-progress");

    // Exit if the elements are not found on the page
    if (!policyContent || !activeProgress) return;

    function updateReadingProgress() {
        // Calculate the distances
        const scrollPosition = window.scrollY;
        const contentTop = policyContent.offsetTop;
        const contentHeight = policyContent.scrollHeight;
        const windowHeight = window.innerHeight;

        // The total scrollable distance for this specific content block
        // (subtracting window height so 100% is reached at the bottom of the content)
        const scrollableDistance = contentHeight - windowHeight + contentTop;

        let scrollPercentage = 0;

        if (scrollableDistance > 0) {
            // Calculate how far down the user has scrolled relative to the content
            scrollPercentage = ((scrollPosition) / scrollableDistance) * 100;
        }

        // Clamp the percentage between 0 and 100 to prevent layout breaking
        scrollPercentage = Math.max(0, Math.min(100, scrollPercentage));

        // Update the height of the Night Bordeaux progress bar
        activeProgress.style.height = `${scrollPercentage}%`;
    }

    // Attach the event listener to the window scroll
    window.addEventListener("scroll", updateReadingProgress, { passive: true });
    
    // Fire once on load in case the user refreshes midway down the page
    updateReadingProgress();
});