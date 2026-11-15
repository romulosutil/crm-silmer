// Keep this classic script synchronous: the saved theme precedes the app and CSS.
(() => {
  let theme = 'light';
  try {
    if (globalThis.localStorage.getItem('silmer-theme') === 'dark')
      theme = 'dark';
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  globalThis.document.documentElement.dataset.theme = theme;
})();
