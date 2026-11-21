(() => {
  const pages = [...document.querySelectorAll('[data-route]')];
  const links = document.querySelectorAll('.site-nav a');
  const articles = [...document.querySelectorAll('[data-topic]')];
  const topicLinks = document.querySelectorAll('[data-topic-link]');
  const topicSelect = document.getElementById('theory-select');
  let currentPage;

  topicSelect?.addEventListener('change', () => {
    window.location.hash = '#/theory?topic=' + encodeURIComponent(topicSelect.value);
  });

  for (const button of document.querySelectorAll('[data-copy-code]')) {
    button.addEventListener('click', async () => {
      const figure = button.closest('figure');
      const status = figure.querySelector('.copy-status');
      const translate = message => globalThis.lbI18n?.translate(message) ?? message;
      try {
        await navigator.clipboard.writeText(figure.querySelector('code').textContent);
        status.textContent = translate('Đã sao chép.');
      } catch {
        status.textContent = translate('Không thể sao chép tự động. Hãy chọn đoạn mã và sao chép.');
      }
    });
  }

  globalThis.lbI18n?.subscribe(() => {
    for (const status of document.querySelectorAll('.copy-status')) status.textContent = '';
  });

  function updateTitle() {
    document.title = `${currentPage.querySelector('h1').textContent} · LB Lab`;
  }

  function focusTopic(target) {
    target.focus({ preventScroll: true });
    if (target.matches('[data-topic-section]')) target.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }

  function showPage() {
    const [route, query] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    let target;
    if (route === '#/theory' && articles.length) {
      const article = articles.find(item => item.dataset.topic === params.get('topic')) || articles[0];
      const section = [...article.querySelectorAll('[data-topic-section]')]
        .find(item => item.dataset.topicSection === params.get('section'));
      target = section || article.querySelector('h2');
      for (const item of articles) item.hidden = item !== article;
      if (topicSelect) topicSelect.value = article.dataset.topic;
      for (const link of topicLinks) {
        if (link.dataset.topicLink === article.dataset.topic) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
    const page = pages.find(candidate => candidate.dataset.route === route) || pages[0];
    if (page === currentPage) {
      if (target) focusTopic(target);
      else if (route === '#/theory') {
        page.querySelector('h1').focus({ preventScroll: true });
        window.scrollTo(0, 0);
      }
      return;
    }

    const moving = Boolean(currentPage);
    currentPage = page;
    for (const candidate of pages) candidate.hidden = candidate !== page;
    for (const link of links) {
      if (link.getAttribute('href') === page.dataset.route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    const heading = page.querySelector('h1');
    updateTitle();
    if (target) {
      focusTopic(target);
    } else if (moving) {
      heading.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  window.addEventListener('hashchange', showPage);
  showPage();
  globalThis.lbI18n?.subscribe(updateTitle);
})();
