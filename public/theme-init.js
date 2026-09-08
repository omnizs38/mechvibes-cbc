"use strict";
// Classic script, run before first paint. No network, no dependency on modules.
(() => {
    let saved = null;
    try {
        saved = localStorage.getItem('theme');
    }
    catch {
        /* Storage is optional. */
    }
    const dark = saved === 'dark' || (saved !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
