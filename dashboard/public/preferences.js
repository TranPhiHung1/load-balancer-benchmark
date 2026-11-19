(() => {
  const root = document.documentElement;
  function read(key) {
    try { return localStorage.getItem('lb-lab.' + key); }
    catch { return null; }
  }
  function apply(key, value) {
    root.dataset[key] = value;
    try { localStorage.setItem('lb-lab.' + key, value); }
    catch { /* Preferences remain usable for the current page. */ }
  }
  root.dataset.theme = read('theme') === 'light' ? 'light' : 'dark';
  root.dataset.language = read('language') === 'en' ? 'en' : 'vi';
  window.lbPreferences = { apply };
})();
