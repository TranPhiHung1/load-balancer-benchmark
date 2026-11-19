(() => {
  const pages = [...document.querySelectorAll('[data-route]')];
  const links = document.querySelectorAll('.site-nav a');
  let currentPage;

  function updateTitle() {
    document.title = `${currentPage.querySelector('h1').textContent} · LB Lab`;
  }

  function showPage() {
    const route = window.location.hash.split('?')[0];
    const page = pages.find(candidate => candidate.dataset.route === route) || pages[0];
    if (page === currentPage) return;

    const moving = Boolean(currentPage);
    currentPage = page;
    for (const candidate of pages) candidate.hidden = candidate !== page;
    for (const link of links) {
      if (link.getAttribute('href') === page.dataset.route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const heading = page.querySelector('h1');
    updateTitle();
    if (moving) {
      heading.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  window.addEventListener('hashchange', showPage);
  showPage();
  globalThis.lbI18n?.subscribe(updateTitle);
})();
