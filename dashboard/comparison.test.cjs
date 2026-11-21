const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compare, comparableResources } = require('./public/resources.js');
const { loadResults } = require('./results.cjs');

test('comparison retains ties and handles missing values, zero baselines and percentage points', () => {
  const first = { status: 'PASS', rps: 100, errorRate: 0.1 };
  const second = { status: 'PASS', rps: 100, errorRate: 0 };
  const failed = { status: 'FAIL', rps: 500, errorRate: 0 };
  const result = compare([first, second, failed], ['rps', '', '', 1, true]);
  assert.deepEqual(result.leaders, [first, second]);
  assert.equal(result.pairs[0].percent, 0);
  assert.equal(result.pairs[1].delta, undefined);
  const errors = compare([first, second], ['errorRate', '', '', 100, false]);
  assert.deepEqual(errors.leaders, [second]);
  assert.equal(errors.pairs[0].delta, 10);
  assert.equal(errors.pairs[0].percent, null);
  assert.deepEqual(compare([{ status: 'PASS', rps: null }], ['rps', '', '', 1, true]).leaders, []);
  assert.equal(compare([{ ...first, rps: 120 }, second], ['rps', '', '', 1, true]).pairs[0].percent, 20);
});

test('saved container comparisons are scoped to the selected run and task', async t => {
  const { batches } = await loadResults();
  const batch = batches.find(item => item.pinned);
  if (!batch) return t.skip('Official saved dataset is unavailable on this checkout');
  const workloads = ['rest', 'keepalive-on', 'keepalive-off', 'http2', 'grpc'];
  for (const workload of workloads) {
    const rows = batch.rows.filter(row => row.workload === workload);
    const matching = comparableResources(batch, workload, rows);
    assert.equal(matching.length, 3, workload);
    assert.ok(matching.every(m => m.workload === workload));
  }
  const rows = batch.rows.filter(row => row.workload === 'rest');
  assert.equal(comparableResources(batch, 'grpc', rows).length, 0);
  assert.equal(comparableResources({ ...batch, id: 'other' }, 'rest', rows).length, 0);
  assert.equal(comparableResources(batch, 'rest', rows.slice(1)).length, 0);
  const differentBasis = structuredClone(batch);
  const sample = differentBasis.resources.measurements.find(m => m.workload === 'rest').samples.find(s => s.memoryBasis);
  sample.memoryBasis = 'raw-usage';
  assert.equal(comparableResources(differentBasis, 'rest', rows).length, 0);
  const differentWindow = structuredClone(batch);
  differentWindow.resources.measurements.find(m => m.workload === 'rest').startedAt = '2000-01-01T00:00:00Z';
  assert.equal(comparableResources(differentWindow, 'rest', rows).length, 0);
});

const fs = require('node:fs');
const vm = require('node:vm');

test('the rendered comparison ranks the saved official REST data and explains missing metrics', async t => {
  const { batches } = await loadResults();
  const official = batches.find(batch => batch.pinned);
  const historical = batches.find(batch => batch.origin === 'historical' && batch.complete && !batch.resources);
  if (!official || !historical) return t.skip('Saved datasets are unavailable on this checkout');
  const panel = {};
  const context = vm.createContext({
    $: () => panel, esc: String, detail: String, tr: String,
    dateLocale: () => 'en-US', names: { nginx: 'Nginx', haproxy: 'HAProxy', envoy: 'Envoy' }
  });
  vm.runInContext(fs.readFileSync(require.resolve('./public/resources.js'), 'utf8'), context);
  const render = vm.runInContext('renderBenchmarkComparison', context);
  const rows = (batch, workload) => ['nginx','haproxy','envoy'].map(balancer =>
    batch.rows.find(row => row.balancer === balancer && row.workload === workload) || { balancer });
  render(official, 'rest', rows(official, 'rest'));
  assert.match(panel.innerHTML, /5,357\.654 RPS/);
  assert.match(panel.innerHTML, /Nginx is 551\.806 RPS above HAProxy \(\+11\.482%\)/);
  assert.match(panel.innerHTML, /Joint leaders[^<]*<\/strong> · Nginx · HAProxy · Envoy/);
  assert.match(panel.innerHTML, /RPS \/ MiB/);
  render(historical, 'rest', rows(historical, 'rest'));
  assert.match(panel.innerHTML, /no saved CPU\/RAM samples/);
  assert.doesNotMatch(panel.innerHTML, /5,357\.654 RPS/);
  render(official, 'rest', [{ balancer: 'nginx' }, ...rows(official, 'rest').slice(1)]);
  assert.match(panel.innerHTML, /Missing a valid PASS value for Nginx/);
  assert.match(panel.innerHTML, /N\/A \(zero baseline\)/);
});
