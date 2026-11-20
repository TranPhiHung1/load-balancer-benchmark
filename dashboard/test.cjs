const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { loadResults, normalize, csv, BALANCERS, WORKLOADS } = require('./results.cjs');
const { createServer, probe } = require('./server.cjs');
const official = 'run-20261108-214448-206-b8432507';
test('All 15 official rows equal original k6 metrics; no inter-batch mixing', async () => {
  const data = await loadResults();
  const historical=data.batches.find(b=>b.id===official);
  assert.ok(historical);
  assert.equal(historical.complete, true);
  assert.equal(historical.rows.length, 15);
  for (const r of historical.rows) {
    const original = JSON.parse(await fs.readFile(path.join(__dirname, '..', r.source), 'utf8'));
    const m = original.metrics;
    assert.equal(r.rps, m[r.workload === 'grpc' ? 'unary_requests' : 'http_reqs'].rate);
    assert.equal(r.total, m[r.workload === 'grpc' ? 'unary_requests' : 'http_reqs'].count);
    assert.equal(r.avg, m[r.workload === 'grpc' ? 'grpc_req_duration' : 'http_req_duration'].avg);
    assert.equal(r.p95, m[r.workload === 'grpc' ? 'grpc_req_duration' : 'http_req_duration']['p(95)']);
    assert.equal(r.errorRate, m[['grpc','http2'].includes(r.workload) ? 'workload_errors' : 'http_req_failed'].value);
    assert.equal(r.status, 'PASS');
  }
});
test('Missing metrics stay N/A; absent metadata never becomes PASS; modern schema supported', async () => {
  const row = normalize({ metrics: {} }, 'rest');
  assert.equal(row.rps, null); assert.equal(row.status, 'N/A');
  assert.throws(() => normalize({}, 'rest'));
  const original = JSON.parse(await fs.readFile(path.join(__dirname, '../benchmark/results', official, 'nginx-rest.json'), 'utf8'));
  assert.equal(normalize(original, 'rest').status, 'N/A');
  const modern = { metrics: Object.fromEntries(Object.entries(original.metrics).map(([k, v]) => [k, { values: v }])) };
  assert.deepEqual(normalize(modern, 'rest', 0), normalize(original, 'rest', 0));
});
test('Malformed JSON is reported without crashing or inventing metrics', async () => {
  const tmp = await fs.mkdtemp(path.join(__dirname, 'test-data-'));
  try {
    await fs.writeFile(path.join(tmp, 'nginx-rest.json'), '{invalid');
    const data = await loadResults(tmp);
    assert.equal(data.warnings.length, 1);
    assert.equal(data.batches[0].rows[0].status, 'N/A');
    assert.equal(data.batches[0].rows[0].rps, undefined);
  } finally { await fs.rm(tmp, { recursive: true }); }
});
test('CSV has exactly the selected workload, all 3 balancers and original source', async () => {
  const batch = (await loadResults()).batches.find(b=>b.id===official);
  for (const w of WORKLOADS) {
    const output = csv(batch, w);
    assert.equal(output.split('\r\n').length, 4);
    for (const b of BALANCERS) assert.ok(output.includes(`"${b}"`));
    assert.ok(output.includes(`/${official}/nginx-${w}.json`));
  }
});
test('Real closed local port returns an explicit offline error', async () => {
  const temp = http.createServer();
  await new Promise(resolve => temp.listen(0, '127.0.0.1', resolve));
  const port = temp.address().port;
  await new Promise(resolve => temp.close(resolve));
  const result = await probe(port, 500);
  assert.equal(result.status, null); assert.equal(result.backend, null); assert.ok(result.error);
});
test('HTTP API, CSV, traversal, Host, Origin and fixed target restrictions', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    const data = await (await fetch(base + '/api/results')).json();
    assert.equal(data.batches[0].rows.length, 15);
    const response = await fetch(base + `/api/export.csv?batch=${official}&workload=grpc`);
    assert.equal(response.status, 200); assert.ok((await response.text()).includes('2809.43514518408'));
    assert.equal((await fetch(base + '/api/export.csv?batch=../../certs&workload=rest')).status, 400);
    assert.equal((await fetch(base + '/certs/localhost.key')).status, 404);
    assert.equal((await fetch(base + '/api/round-robin/http://example.com', { method: 'POST', headers: { 'X-Dashboard-Action': 'demo' } })).status, 404);
    assert.equal((await fetch(base + '/api/round-robin/nginx', { method: 'POST' })).status, 403);
    assert.equal((await fetch(base + '/api/round-robin/nginx', { method: 'POST', headers: { Origin: 'https://example.com', 'X-Dashboard-Action': 'demo' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
      http.get(base, { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(badHostStatus, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('Frontend renders all 5 workloads and charts from actual API rows, including missing values', async () => {
  const data = await loadResults();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false, querySelector: () => ({}) });
    return elements.get(id);
  };
  let exportedBlob, downloaded = false;
  const context = vm.createContext({ document: { getElementById: element, querySelectorAll: () => [], createElement: () => ({ click: () => { downloaded = true; } }) },
    Blob, URL: { createObjectURL: blob => { exportedBlob = blob; return 'blob:test'; }, revokeObjectURL: () => {} }, setTimeout: fn => fn(),
    window: {}, fetch: async () => { throw new Error('No automatic network in render test'); }, console });
  const code = await fs.readFile(path.join(__dirname, 'public/app.js'), 'utf8');
  vm.runInContext(code.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/, ''), context);
  context.realData = data;
  vm.runInContext('results = realData', context);
  element('batch').value = official;
  for (const w of WORKLOADS) {
    element('workload').value = w;
    vm.runInContext('render()', context);
    const rows = data.batches.find(b=>b.id===official).rows.filter(r => r.workload === w);
    for (const r of rows) {
      assert.ok(element('benchmark-table').innerHTML.includes(r.rps.toLocaleString('en-US', { maximumFractionDigits: 3 })));
      assert.ok(element('sources').innerHTML.includes(r.source));
    }
    assert.equal((element('charts').innerHTML.match(/class="chart"/g) || []).length, 4);
    assert.ok(!element('charts').innerHTML.includes('NaN'));
    element('export').onclick();
    assert.equal(downloaded, true);
    assert.equal(await exportedBlob.text(), csv(data.batches.find(b=>b.id===official), w).replace(/^\uFEFF/, ''));
  }
  element('batch').value = 'missing';
  vm.runInContext('render()', context);
  assert.ok(element('benchmark-table').innerHTML.includes('N/A'));
  assert.ok(!element('charts').innerHTML.includes('width:100%'));
});

async function demoView() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { value: '', innerHTML: '', textContent: '', disabled: false,
        classList: { add: (...c) => c.forEach(v => classes.add(v)), remove: (...c) => c.forEach(v => classes.delete(v)), contains: c => classes.has(c) },
        querySelector: () => ({}), closest: () => null });
    }
    return elements.get(id);
  };
  const context = vm.createContext({ document: { getElementById: element, querySelectorAll: () => [] }, console });
  const app = await fs.readFile(path.join(__dirname, 'public/app.js'), 'utf8');
  vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/, ''), context);
  element('demo-balancer').value = 'nginx'; element('demo-algorithm').value = 'round-robin'; element('demo-speed').value = 'normal';
  vm.runInContext(await fs.readFile(path.join(__dirname, 'public/demo.js'), 'utf8'), context);
  return { context, element, event: e => { context.incoming = e; vm.runInContext('handleDemoEvent(incoming)', context); } };
}
async function consumeStream(response, onEvent) {
  assert.equal(response.status, 200);
  assert.ok(response.headers.get('content-type').includes('application/x-ndjson'));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const events = []; let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const event = JSON.parse(buffer.slice(0,newline)); buffer = buffer.slice(newline+1);
      events.push({ event, at: Date.now() });
      if (onEvent) onEvent(event, events);
    }
    if (done) break;
  }
  assert.equal(buffer, '');
  return events;
}
test('10 real streamed requests: ordered immediate results, pacing, progress, flow and reset', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const view = await demoView();
  vm.runInContext('demoTotal = 10', view.context);
  const headers = { 'X-Dashboard-Action':'demo' };
  try {
    const events = await consumeStream(await fetch(base + '/api/demo-stream/nginx?algorithm=round-robin&count=10&speed=normal', { method:'POST', headers }), event => {
      view.event(event);
      if (event.type === 'result') {
        assert.equal(view.element('demo-progress').value, event.row.number);
        const rows = vm.runInContext('demoRows', view.context);
        assert.equal(rows.length, event.row.number);
        const b1 = rows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-1').length;
        const b2 = rows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-2').length;
        assert.equal(b1 + b2 + rows.filter(r => r.error || r.status !== 200 || !r.backend).length, rows.length);
        assert.ok(view.element('demo-history').innerHTML.includes('latest-row'));
        if (event.row.backend) assert.ok(view.element('flow-'+event.row.backend).classList.contains(event.row.error ? 'failed' : 'active'));
      }
    });
    assert.equal(events.length, 22);
    assert.equal(events[0].event.type, 'start');
    assert.equal(events.at(-1).event.type, 'done');
    for (let i=1;i<=10;i++) {
      assert.equal(events[2*i-1].event.type, 'request'); assert.equal(events[2*i-1].event.number, i);
      assert.equal(events[2*i].event.type, 'result'); assert.equal(events[2*i].event.row.number, i);
      if (i<10) assert.ok(events[2*i+1].at-events[2*i].at >= 850, 'Next request must wait for presentation interval after real result');
    }
    assert.ok(events[2].at < events.at(-1).at - 7000, 'First result is streamed before the run finishes');
    assert.equal(view.element('demo-state').textContent, 'Hoàn thành kiểm thử');
    vm.runInContext('resetDemo()',view.context);
    assert.equal(view.element('demo-history').innerHTML, ''); assert.equal(view.element('demo-progress').value,0);
    assert.equal(vm.runInContext('demoRows.length',view.context),0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('20 real streamed requests and legacy 10-request API remain supported; algorithms are blocked', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, options = { method:'POST', headers:{'X-Dashboard-Action':'demo'} };
  try {
    assert.equal((await fetch(`${base}/api/demo-stream/envoy?algorithm=invalid&count=10&speed=fast`, options)).status,400);
    for (const query of ['algorithm=round-robin&count=100&speed=fast','algorithm=round-robin&count=10&speed=invalid']) {
      assert.equal((await fetch(`${base}/api/demo-stream/envoy?${query}`,options)).status,400);
    }
    const events = await consumeStream(await fetch(base+'/api/demo-stream/envoy?algorithm=round-robin&count=20&speed=fast', options));
    assert.equal(events.filter(e=>e.event.type==='result').length,20);
    const response = await fetch(base+'/api/round-robin/haproxy',options);
    assert.equal(response.status,200); assert.equal((await response.json()).rows.length,10);
    const page = await (await fetch(base)).text();
    for (const label of ['Demo các thuật toán cân bằng tải','Gửi 10 yêu cầu','Gửi 20 yêu cầu','Đặt lại kết quả','Chọn đợt kiểm thử','Chọn loại kiểm thử','Làm mới kết quả']) assert.ok(page.includes(label));
    assert.match(page, /value="ip-hash">IP Hash \/ Source-IP Affinity/);
    assert.match(page, /value="least-connections">Least Connections \/ Least Request/);
    assert.match(page, /value="weighted-round-robin" title=/);
    assert.equal((await fetch(base+'/demo.js')).status,200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('WRR stream calls the dedicated path and displays identified and unknown responses', async t => {
  const paths = [];
  const upstream = http.createServer((req, res) => {
    paths.push(req.url);
    if (paths.length === 10) { res.writeHead(503); res.end('Unavailable'); return; }
    res.end(JSON.stringify({ port: paths.length <= 7 ? 3001 : 3002 }));
  });
  const server = createServer();
  for (const instance of [upstream, server]) {
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => instance.close(resolve)));
  }
  const originalGet = http.get;
  const calls = t.mock.method(http, 'get', (options, callback) => originalGet({
    ...options, port: upstream.address().port,
  }, callback));
  const view = await demoView();
  view.element('demo-algorithm').value = 'weighted-round-robin';
  view.element('demo-algorithm').onchange();
  assert.equal(view.element('send-100').hidden, false);
  vm.runInContext('demoTotal = 10', view.context);
  const base = `http://127.0.0.1:${server.address().port}`;
  const events = await consumeStream(await fetch(base + '/api/demo-stream/nginx?algorithm=weighted-round-robin&count=10&speed=fast', {
    method: 'POST', headers: { 'X-Dashboard-Action': 'demo' },
  }), view.event);
  assert.equal(calls.mock.calls[0].arguments[0].port, 8080);
  assert.deepEqual(paths, Array(10).fill('/api/wrr'));
  assert.deepEqual(events.at(-2).event.row.backend, null);
  assert.equal(events.at(-2).event.row.status, 503);
  assert.match(view.element('demo-history').innerHTML, /Weighted Round Robin.*Không xác định.*503/);
  assert.match(view.element('count-backend-1').textContent, /^7 .*70/);
  assert.match(view.element('count-backend-2').textContent, /^2 .*20/);
  view.element('demo-algorithm').value = 'round-robin';
  view.element('demo-algorithm').onchange();
  assert.equal(view.element('send-100').hidden, true);
  assert.equal(view.element('demo-history').innerHTML, '');
});
test('Least stream uses its own endpoint and reports observed counts without a target ratio', async t => {
  const paths = [];
  const upstream = http.createServer((req, res) => {
    paths.push(req.url);
    res.end(JSON.stringify({ port: 3002 }));
  });
  const server = createServer();
  for (const instance of [upstream, server]) {
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => instance.close(resolve)));
  }
  const originalGet = http.get;
  const calls = t.mock.method(http, 'get', (options, callback) => originalGet({
    ...options, port: upstream.address().port,
  }, callback));
  const view = await demoView();
  view.element('demo-algorithm').value = 'least-connections';
  view.element('demo-algorithm').onchange();
  for (const [id, policy] of [['nginx', 'least_conn'], ['haproxy', 'leastconn'], ['envoy', 'FULL_SCAN']]) {
    view.element('demo-balancer').value = id;
    view.element('demo-balancer').onchange();
    assert.ok(view.element('least-policy').textContent.includes(policy));
  }
  assert.equal(view.element('least-note').hidden, false);
  assert.equal(view.element('wrr-expected').hidden, true);
  assert.equal(view.element('send-100').hidden, true);
  vm.runInContext('demoTotal = 20', view.context);
  const base = `http://127.0.0.1:${server.address().port}/api/demo-stream/envoy?algorithm=least-connections&speed=fast&count=`;
  const options = { method: 'POST', headers: { 'X-Dashboard-Action': 'demo' } };
  assert.equal((await fetch(base + '100', options)).status, 400);
  const events = await consumeStream(await fetch(base + '20', options), view.event);
  assert.equal(calls.mock.calls[0].arguments[0].port, 8082);
  assert.deepEqual(paths, Array(20).fill('/api/least'));
  assert.equal(events.at(-1).event.type, 'done');
  assert.match(view.element('count-backend-2').textContent, /^20 .*100/);
});
test('IP Hash streams an observed IP mapping from the dedicated proxy response', async t => {
  const upstream = http.createServer((req, res) => {
    assert.equal(req.url, '/api/iphash');
    assert.equal(req.headers['x-forwarded-for'], undefined);
    res.setHeader('X-Lab-Source-IP', '127.0.0.1');
    res.end(JSON.stringify({ port: 3001 }));
  });
  const server = createServer();
  for (const instance of [upstream, server]) {
    await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => instance.close(resolve)));
  }
  const originalGet = http.get;
  t.mock.method(http, 'get', (options, callback) => originalGet({
    ...options, port: upstream.address().port,
  }, callback));
  const view = await demoView();
  view.element('demo-algorithm').value = 'ip-hash';
  view.element('demo-algorithm').onchange();
  assert.match(view.element('ip-policy').textContent, /ip_hash/);
  vm.runInContext('demoTotal = 10', view.context);
  const base = `http://127.0.0.1:${server.address().port}/api/demo-stream/nginx?algorithm=ip-hash&speed=fast&count=`;
  const options = { method: 'POST', headers: { 'X-Dashboard-Action': 'demo', 'X-Forwarded-For': '198.51.100.1' } };
  assert.equal((await fetch(base + '100', options)).status, 400);
  const events = await consumeStream(await fetch(base + '10', options), view.event);
  assert.equal(events.at(-1).event.type, 'done');
  assert.equal(view.element('ip-mapping').textContent, '127.0.0.1 → Backend 1');
  assert.equal(view.element('wrr-expected').hidden, true);
});
test('Real offline response is shown as failure without backend increments; unsupported frontend choices cannot run', async () => {
  const temp = http.createServer();
  await new Promise(resolve => temp.listen(0,'127.0.0.1',resolve));
  const port = temp.address().port; await new Promise(resolve=>temp.close(resolve));
  const result = await probe(port,500);
  const view = await demoView(); vm.runInContext('demoTotal = 10',view.context);
  view.event({ type:'request',number:1 });
  view.event({ type:'result',row:{...result,number:1,algorithm:'round-robin',balancer:'nginx'} });
  assert.equal(view.element('demo-progress').value,1);
  assert.ok(view.element('demo-history').innerHTML.includes('Thất bại'));
  assert.ok(view.element('count-backend-1').textContent.startsWith('0 yêu cầu'));
  assert.ok(view.element('count-backend-2').textContent.startsWith('0 yêu cầu'));
  assert.ok(view.element('flow-lb').classList.contains('failed'));
  assert.throws(()=>view.event({type:'result',row:{...result,number:1,algorithm:'round-robin',balancer:'nginx'}}));
  view.element('demo-algorithm').value='invalid'; vm.runInContext('updateAlgorithm()',view.context);
  assert.equal(view.element('send-10').disabled,true); assert.equal(view.element('send-20').disabled,true);
  await vm.runInContext("runDemos(['nginx'])",view.context);
  assert.equal(vm.runInContext('demoRows.length',view.context),1);
});
test('Disconnect cancels remaining streamed requests and releases shared demo lock', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`, options={method:'POST',headers:{'X-Dashboard-Action':'demo'}};
  try {
    const response = await fetch(base+'/api/demo-stream/nginx?algorithm=round-robin&count=20&speed=slow',options);
    const reader = response.body.getReader(); await reader.read();
    assert.equal((await fetch(base+'/api/round-robin/nginx',options)).status,409);
    await reader.cancel();
    let unlocked=false;
    for(let i=0;i<30;i++) {
      await new Promise(resolve=>setTimeout(resolve,100));
      const result=await fetch(base+'/api/round-robin/nginx',options);
      if(result.status===200) { assert.equal((await result.json()).rows.length,10); unlocked=true; break; }
      await result.text();
    }
    assert.equal(unlocked,true);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
