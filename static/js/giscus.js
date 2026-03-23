function getGiscusTheme() {
    const theme = getTargetAppearance();
    return theme === 'dark' ? 'dark_dimmed' : 'light';
}

function updateGiscusTheme() {
    const iframe = document.querySelector('iframe.giscus-frame');
    if (!iframe) return;
    iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: getGiscusTheme() } } },
        'https://giscus.app'
    );
}

// Set correct theme on initial load
window.addEventListener('message', (e) => {
    if (e.origin !== 'https://giscus.app') return;
    // Giscus sends a message when it's ready
    if (e.data?.giscus) updateGiscusTheme();
});

// Re-sync when PaperMod's theme toggle is clicked
document.getElementById('theme-toggle')?.addEventListener('click', () => {
    // Small delay to let PaperMod update html[data-theme] first
    setTimeout(updateGiscusTheme, 50);
});
document.getElementById('appearance-switcher')?.addEventListener('click', () => {
    // Small delay to let PaperMod update html[data-theme] first
    setTimeout(updateGiscusTheme, 50);
});
document.getElementById('appearance-switcher-mobile')?.addEventListener('click', () => {
    // Small delay to let PaperMod update html[data-theme] first
    setTimeout(updateGiscusTheme, 50);
});
console.log('Giscus theme sync initialized');