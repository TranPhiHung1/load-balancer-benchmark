const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { createServer } = require('./server.cjs');

test('Project pages preserve dashboard controls and support direct links and history navigation', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<script src="\/navigation\.js" defer>/);
  const script = await fetch(base + '/navigation.js');
  assert.equal(script.status, 200);
  const source = await script.text();

  const routeStarts = [...html.matchAll(/<div id="page-[^"]+" class="site-page" data-route="([^"]+)"( hidden)?>/g)];
  const routes = ['#/', '#/demo', '#/benchmark', '#/team', '#/theory'];
  assert.deepEqual(routeStarts.map(match => match[1]), routes);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  function markup(index) {
    return html.slice(routeStarts[index].index, routeStarts[index + 1]?.index);
  }
  for (const id of ['demo-balancer', 'demo-algorithm', 'send-10', 'send-20', 'test-all', 'reset-demo', 'demo-history']) {
    assert.ok(markup(1).includes(`id="${id}"`), id);
  }
  const benchmarkControls = ['status', 'batch', 'workload', 'export', 'charts', 'trash-panel', 'saved-resources', 'bench-start', 'bench-stop', 'bench-log', 'live-resources'];
  for (const id of benchmarkControls) assert.ok(markup(2).includes(`id="${id}"`), id);
  assert.match(markup(2), /id="status"[\s\S]*id="saved-results"[\s\S]*id="run-benchmark"/);

  function open(hash) {
    const pages = routes.map(route => ({
      dataset: { route },
      heading: { textContent: route, focus() {} },
      querySelector() { return this.heading; },
    }));
    const links = routes.map(route => ({
      getAttribute: () => route,
      setAttribute(_name, value) { this.current = value; },
      removeAttribute() { delete this.current; },
    }));
    let focused;
    const topicIds = [...markup(4).matchAll(/data-topic="([^"]+)"/g)].map(match => match[1]);
    const articles = topicIds.map(topic => ({
      dataset: { topic },
      querySelector: () => ({ focus() { focused = 'title-' + topic; }, scrollIntoView() {}, matches: () => false }),
      querySelectorAll: () => [],
    }));
    const topicLinks = topicIds.map(topic => ({
      dataset: { topicLink: topic },
      setAttribute(_attribute, value) { this.current = value; },
      removeAttribute() { delete this.current; },
    }));
    const select = { addEventListener() {} };
    const document = {
      querySelectorAll: selector => ({
        '[data-route]': pages, '.site-nav a': links, '[data-topic]': articles, '[data-topic-link]': topicLinks
      })[selector] || [],
      getElementById: () => select,
    };
    let onHashChange;
    const window = {
      location: { hash },
      scrollTo() {},
      addEventListener(event, listener) {
        assert.equal(event, 'hashchange');
        onHashChange = listener;
      },
    };
    vm.runInNewContext(source, { document, window, URLSearchParams });
    function assertActive(index) {
      assert.deepEqual(pages.map(page => page.hidden), routes.map((_, i) => i !== index));
      assert.deepEqual(links.map(link => link.current), routes.map((_, i) => i === index ? 'page' : undefined));
      assert.equal(document.title, `${routes[index]} · LB Lab`);
    }
    return {
      assertActive,
      get focused() { return focused; },
      navigate(route) { window.location.hash = route; onHashChange(); },
      pages,
      activeTopics: () => articles.filter(article => !article.hidden).map(article => article.dataset.topic),
      activeTopicLinks: () => topicLinks.filter(link => link.current).map(link => link.dataset.topicLink),
      selectedTopic: () => select.value,
    };
  }
  routes.forEach((route, index) => open(route).assertActive(index));
  open('#/demo?tab=health').assertActive(1);
  const theory = open('#/theory?topic=nginx');
  theory.assertActive(4);
  assert.equal(theory.focused, 'title-nginx');
  assert.deepEqual(theory.activeTopics(), ['nginx']);
  assert.deepEqual(theory.activeTopicLinks(), ['nginx']);
  assert.equal(theory.selectedTopic(), 'nginx');
  theory.navigate('#/theory?topic=envoy');
  assert.equal(theory.focused, 'title-envoy');
  assert.deepEqual(theory.activeTopics(), ['envoy']);
  theory.navigate('#/theory?topic=unknown');
  assert.deepEqual(theory.activeTopics(), ['load-balancer']);
  assert.match(markup(0), /href="#\/theory\?topic=nodejs"/);
  assert.doesNotMatch(markup(0), /lb-theory|bench-study/);
  assert.doesNotMatch(markup(3), /lab-topology|deployment-model/);
  const topology = markup(0);
  for (const port of [8080, 8081, 8082, 3001, 3002]) assert.match(topology, new RegExp(String(port)));
  const linksToBackends = [...topology.matchAll(/data-from="([^"]+)" data-to="([^"]+)"/g)];
  assert.equal(linksToBackends.length, 6);
  for (const proxy of ['nginx', 'haproxy', 'envoy']) {
    assert.deepEqual(linksToBackends.filter(link => link[1] === proxy).map(link => link[2]), ['backend-1', 'backend-2']);
  }
  const theoryMarkup = markup(4);
  const articles = [...theoryMarkup.matchAll(/<article class="theory-topic"[\s\S]+?<\/article>/g)];
  assert.equal(articles.length, 15);
  for (const [article] of articles) {
    assert.match(article, /theory-lead/);
    assert.match(article, /Nguyên lý và đánh đổi/);
    assert.match(article, /Ví dụ minh họa/);
    assert.match(article, /Trong lab/);
    assert.match(article, /Tình huống áp dụng/);
    assert.match(article, /Kiến thức cần nhớ/);
  }
  assert.match(theoryMarkup, /id="title-nginx"[\s\S]*?Master nạp cấu hình/);
  const app = open('#/demo');
  app.pages[1].demoProgress = 7;
  app.navigate('#/benchmark');
  app.assertActive(2);
  app.navigate('#/demo');
  app.assertActive(1);
  assert.equal(app.pages[1].demoProgress, 7);
  app.navigate('#/benchmark');
  app.assertActive(2);
  app.navigate('#/unknown');
  app.assertActive(0);
});

const asset = file => fs.readFile(path.join(__dirname, 'public', file), 'utf8');

test('Preferences default to Vietnamese and dark, reapply after reload, and translate existing messages', async () => {
  const [preferences, i18n] = await Promise.all(['preferences.js', 'i18n.js'].map(asset));
  const saved = new Map();
  function open() {
    const root = { dataset: {}, classList: new Set() };
    const node = { nodeValue: '  Demo thuật toán ', isConnected: true };
    const buttons = new Map();
    const getElementById = id => {
      if (!buttons.has(id)) buttons.set(id, { setAttribute() {} });
      return buttons.get(id);
    };
    const document = {
      documentElement: root,
      body: {},
      createTreeWalker() {
        let available = true;
        return { currentNode: node, nextNode() { const next = available; available = false; return next; } };
      },
      querySelectorAll: () => [],
      getElementById,
    };
    const window = {};
    const localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
    const context = vm.createContext({ document, window, localStorage, NodeFilter: { SHOW_TEXT: 4 } });
    vm.runInContext(preferences, context);
    vm.runInContext(i18n, context);
    return { root, node, buttons, window, context };
  }
  const first = open();
  assert.equal(first.root.dataset.theme, 'dark');
  assert.equal(first.root.lang, 'vi');
  let changes = 0;
  first.window.lbI18n.subscribe(() => changes++);
  first.buttons.get('theme-toggle').onclick();
  first.buttons.get('language-toggle').onclick();
  assert.equal(changes, 1);
  assert.equal(first.node.nodeValue, '  Algorithm demo ');
  assert.equal(vm.runInContext('window.lbI18n.translate`Số bài hoàn thành: ${3}/${15}`', first.context), 'Tests completed: 3/15');
  assert.equal(first.window.lbI18n.detail('nginx không sẵn sàng: Timeout sau 2000 ms'), 'nginx is unavailable: Timed out after 2000 ms');
  const fresh = open();
  assert.equal(fresh.root.dataset.theme, 'light');
  assert.equal(fresh.root.lang, 'en');
  fresh.buttons.get('language-toggle').onclick();
  assert.equal(fresh.node.nodeValue, '  Demo thuật toán ');
});

test('Demo and Benchmark share one status component and refresh it on navigation', async () => {
  const app = (await asset('app.js')).replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/, '');
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  };
  let onHashChange;
  const window = { location: { hash: '#/demo' }, addEventListener: (event, listener) => {
    assert.equal(event, 'hashchange');
    onHashChange = listener;
  } };
  const section = getElementById('system-overview');
  for (const id of ['page-demo', 'page-benchmark']) {
    getElementById(id).querySelector = () => ({
      after(node) { assert.equal(node, section); node.mountedIn = id; },
    });
  }
  let checks = 0;
  const fetch = async url => {
    assert.equal(url, '/api/status');
    const state = ++checks === 1 ? 'Online' : 'Offline';
    return { ok: true, json: async () => ({ checkedAt: '2026-11-19T00:00:00Z', components: [
      { id: 'nginx', state, status: state === 'Online' ? 200 : null, error: state === 'Offline' ? 'ECONNREFUSED' : null },
    ] }) };
  };
  vm.runInNewContext(app, { document: { getElementById }, window, fetch, lbPreferences: {} });
  await new Promise(setImmediate);
  assert.equal(section.mountedIn, 'page-demo');
  assert.match(getElementById('status').innerHTML, /state Online/);
  window.location.hash = '#/benchmark';
  onHashChange();
  await new Promise(setImmediate);
  assert.equal(section.mountedIn, 'page-benchmark');
  assert.match(getElementById('status').innerHTML, /state Offline/);
  assert.doesNotMatch(getElementById('status').innerHTML, /state Online/);
  assert.equal(checks, 2);
});
