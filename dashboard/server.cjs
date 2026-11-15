const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { loadResults, csv, WORKLOADS } = require('./results.cjs');
const { createBenchmarkRunner } = require('./benchmark-runner.cjs');
const { createResultStorage } = require('./result-storage.cjs');
const TARGETS = Object.freeze({ nginx: 8080, haproxy: 8081, envoy: 8082, 'backend-1': 3001, 'backend-2': 3002 });
const SPEEDS = Object.freeze({ fast: 150, normal: 1000, slow: 1800 });
function probe(port, timeout = 2000) {
  const start = performance.now();
  return new Promise(resolve => {
    let done = false;
    const finish = result => { if (!done) { done = true; clearTimeout(timer); resolve({ ...result, ms: Math.round((performance.now() - start) * 100) / 100 }); } };
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api', agent: false, headers: { Connection: 'close' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(new Error('Response quá lớn')); });
      res.on('error', e => finish({ status: res.statusCode, backend: null, error: e.message }));
      res.on('end', () => {
        let payload;
        try { payload = JSON.parse(body); } catch { return finish({ status: res.statusCode, backend: null, error: 'Response không phải JSON hợp lệ' }); }
        const backend = payload.port === 3001 ? 'backend-1' : payload.port === 3002 ? 'backend-2' : null;
        finish({ status: res.statusCode, backend, error: res.statusCode !== 200 ? `HTTP ${res.statusCode}` : !backend ? 'Không nhận diện được backend từ JSON.port' : null });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Timeout sau ' + timeout + ' ms')), timeout);
    req.on('error', e => finish({ status: null, backend: null, error: e.code || e.message }));
  });
}
function createServer(options = {}) {
  let busy = false;
  const benchmark = options.benchmarkRunner || createBenchmarkRunner();
  const resultStorage=options.resultStorage || createResultStorage({active:()=>benchmark.active()});
  const readResults=options.loadResults || loadResults;
  const server = http.createServer(async (req, res) => {
    const send = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$/.test(req.headers.host || '')) return send(403, { error: 'Host không hợp lệ' });
      if (req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(403, { error: 'Origin không hợp lệ' });
        const isBenchmark = url.pathname.startsWith('/api/benchmark/');
        const isStorage=url.pathname.startsWith('/api/results/');
        if (req.headers['x-dashboard-action'] !== (isStorage ? 'results' : isBenchmark ? 'benchmark' : 'demo')) return send(403, { error: 'Thiếu header hành động' });
        if(['/api/results/trash','/api/results/restore'].includes(url.pathname)) {
          if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Yêu cầu JSON'});
          let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return send(413,{error:'Yêu cầu quá lớn'});}
          let input;try{input=JSON.parse(body);}catch{return send(400,{error:'JSON không hợp lệ'});}
          if(!input || Array.isArray(input) || Object.keys(input).some(k=>!['id','confirmed'].includes(k)) || input.confirmed!==true)return send(400,{error:'Chỉ nhận ID và xác nhận rõ ràng, không nhận đường dẫn'});
          const result=await (url.pathname.endsWith('/restore') ? resultStorage.restore(input.id) : resultStorage.trash(input.id));
          return send(200,result);
        }
        if (url.pathname === '/api/benchmark/start') {
          if (busy) return send(409, { error:'Demo đang chạy, vui lòng chờ kết thúc' });
          if (!req.headers['content-type']?.startsWith('application/json')) return send(415,{error:'Yêu cầu JSON'});
          let body = '';
          for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(413,{error:'Yêu cầu quá lớn'}); }
          let input;
          try { input = JSON.parse(body); } catch { return send(400,{error:'JSON không hợp lệ'}); }
          return send(202, await benchmark.start(input));
        }
        if (url.pathname === '/api/benchmark/stop') return send(200,benchmark.stop());
        const streamMatch = /^\/api\/demo-stream\/(nginx|haproxy|envoy)$/.exec(url.pathname);
        if (streamMatch) {
          const algorithm = url.searchParams.get('algorithm');
          const count = Number(url.searchParams.get('count'));
          const speed = url.searchParams.get('speed');
          if (algorithm !== 'round-robin' || ![10, 20].includes(count) || !Object.hasOwn(SPEEDS, speed)) return send(400, { error: 'Chỉ hỗ trợ Round Robin, 10/20 yêu cầu và tốc độ hợp lệ. Các thuật toán khác chưa triển khai.' });
          if (busy || benchmark.active()) return send(409, { error: 'Demo hoặc benchmark đang chạy, vui lòng chờ' });
          busy = true;
          const controller = new AbortController();
          const disconnected = () => controller.abort();
          res.on('close', disconnected);
          const event = data => { if (!res.destroyed) res.write(JSON.stringify(data) + '\n'); };
          try {
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
            res.flushHeaders();
            event({ type: 'start', count, algorithm, balancer: streamMatch[1], delayMs: SPEEDS[speed] });
            for (let i = 1; i <= count && !controller.signal.aborted; i++) {
              event({ type: 'request', number: i });
              const row = { number: i, balancer: streamMatch[1], algorithm, ...await probe(TARGETS[streamMatch[1]]) };
              if (controller.signal.aborted) break;
              event({ type: 'result', row });
              if (i < count) await require('node:timers/promises').setTimeout(SPEEDS[speed], undefined, { signal: controller.signal });
            }
            if (!controller.signal.aborted) event({ type: 'done', count });
          } catch (e) {
            if (!controller.signal.aborted) event({ type: 'error', error: 'Luồng kiểm thử bị gián đoạn' });
          } finally { busy = false; res.off('close', disconnected); res.end(); }
          return;
        }
        const match = /^\/api\/round-robin\/(nginx|haproxy|envoy)$/.exec(url.pathname);
        if (!match) return send(404, { error: 'Không có endpoint này' });
        if (busy || benchmark.active()) return send(409, { error: 'Demo hoặc benchmark đang chạy, vui lòng chờ' });
        busy = true;
        try {
          const rows = [];
          for (let i = 1; i <= 10; i++) rows.push({ number: i, balancer: match[1], ...await probe(TARGETS[match[1]]) });
          return send(200, { rows });
        } finally { busy = false; }
      }
      if (req.method !== 'GET') return send(405, { error: 'Method không được hỗ trợ' });
      if (url.pathname === '/api/benchmark/config') return send(200,await benchmark.config());
      if (url.pathname === '/api/benchmark/status') return send(200,{job:benchmark.snapshot(),busy:benchmark.active()});
      if (url.pathname === '/api/status') {
        const components = await Promise.all(Object.entries(TARGETS).map(async ([id, port]) => {
          const result = await probe(port);
          const expected = !id.startsWith('backend') || result.backend === id;
          return { id, port, ...result, state: !result.status || result.status >= 400 ? 'Offline' : !result.error && expected ? 'Online' : 'Unknown' };
        }));
        return send(200, { components, checkedAt: new Date().toISOString() });
      }
      if (url.pathname === '/api/results') return send(200, await resultStorage.annotate(await readResults()));
      if (url.pathname === '/api/results/trash') return send(200,await resultStorage.listTrash());
      if (url.pathname === '/api/export.csv') {
        const data = await readResults(), batch = data.batches.find(b => b.id === url.searchParams.get('batch')), workload = url.searchParams.get('workload');
        if (!batch || !WORKLOADS.includes(workload)) return send(400, { error: 'Đợt hoặc workload không hợp lệ' });
        res.setHeader('Content-Disposition', 'attachment; filename="benchmark.csv"');
        return send(200, csv(batch, workload), 'text/csv; charset=utf-8');
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/demo.js': ['demo.js', 'text/javascript'], '/benchmark.js': ['benchmark.js', 'text/javascript'], '/results-management.js': ['results-management.js', 'text/javascript'], '/resources.js': ['resources.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const asset = assets[url.pathname];
      if (!asset) return send(404, { error: 'Không tìm thấy' });
      return send(200, await fs.readFile(path.join(__dirname, 'public', asset[0])), asset[1] + '; charset=utf-8');
    } catch (e) { send(e.status || 500, { error: e.status ? e.message : 'Không xử lý được yêu cầu', detail: e.code || 'INVALID_DATA' }); }
  });
  server.benchmark = benchmark;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.DASHBOARD_PORT || 5173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || Object.values(TARGETS).includes(port) || [8440,8441,8442,9440,9441,9442].includes(port)) throw new Error('Cổng Dashboard không hợp lệ hoặc trùng cổng hệ thống');
  const server = createServer();
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Cổng ${port} đang bận. Đặt $env:DASHBOARD_PORT='5174' rồi chạy lại.` : e.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Dashboard: http://127.0.0.1:${port}`));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true; server.close();
    server.benchmark.shutdown();
    const check = setInterval(() => {
      if (!server.benchmark.active()) { clearInterval(check); process.exit(0); }
    },100);
    if (!server.benchmark.active()) { clearInterval(check); process.exit(0); }
  };
  process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);
}
module.exports = { createServer, probe, SPEEDS };
