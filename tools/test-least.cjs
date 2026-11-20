// Run from the repository with Docker Compose available: node tools/test-least.cjs
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function fixture(port) {
  let active = 0;
  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    const json = value => res.end(JSON.stringify(value));
    if (url.pathname === '/active') return json({ active });
    if (url.pathname !== '/api') { res.writeHead(404); res.end(); return; }
    if (url.searchParams.get('hold') !== '1') return json({ port });
    active++;
    const timer = setTimeout(() => json({ port }), 4000);
    res.once('close', () => { clearTimeout(timer); active--; });
  }).listen(port, '0.0.0.0');
}

function get(addr, route, agent = false, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://${addr}${route}`, { agent, signal: AbortSignal.timeout(timeout) }, res => {
      let body = '';
      res.setEncoding('utf8').on('data', chunk => body += chunk);
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 200);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
  });
}

async function observe(addr, route, backends) {
  const hold = get(addr, route + '?hold=1', false, 5500);
  // Install a rejection handler immediately; still await the original promise below.
  hold.catch(() => {});
  const active = async () => Promise.all(backends.map(binding => get(binding, '/active')));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    let state;
    for (let i = 0; i < 20; i++) {
      state = await active();
      if (state.some(item => item.active === 1)) break;
      await delay(40);
    }
    const busy = state.findIndex(item => item.active === 1);
    assert.notEqual(busy, -1, 'Held request must reach an upstream');
    const busyPort = 3001 + busy;
    const picks = [];
    for (let i = 0; i < 8; i++) picks.push((await get(addr, route, agent)).port);
    assert.equal((await active())[busy].active, 1, 'Held request must overlap all eight probes');
    assert.equal((await hold).port, busyPort);
    assert.ok(picks.every(port => port === 3001 || port === 3002));
    return { busyPort, hitsOnBusy: picks.filter(port => port === busyPort).length };
  } finally {
    agent.destroy();
    await hold.catch(() => {});
  }
}

async function run() {
  const docker = process.env.LEAST_TEST_DOCKER || 'docker';
  const root = path.join(__dirname, '..');
  const cmd = (args, input) => execFileSync(docker, args, { cwd: root, encoding: 'utf8', input, timeout: 45000 }).trim();
  const project = 'least-test-' + randomBytes(4).toString('hex');
  const proxies = ['nginx', 'haproxy', 'envoy'];
  const backends = ['backend-1', 'backend-2'];
  const override = ['services:'];
  for (const [i, service] of backends.entries()) {
    const port = String(3001 + i);
    const image = cmd(['inspect', '--format', '{{.Image}}', service]);
    override.push(`  ${service}:`, `    container_name: ${project}-${service}`, `    image: ${image}`,
      `    ports: !override ['127.0.0.1::${port}']`,
      '    volumes: ["./tools/test-least.cjs:/least-test.cjs:ro"]',
      `    entrypoint: ["node", "/least-test.cjs", "fixture", "${port}"]`, '    command: []');
  }
  for (const proxy of proxies) override.push(`  ${proxy}:`, `    container_name: ${project}-${proxy}`,
    "    ports: !override ['127.0.0.1::80']");
  const compose = (...args) => cmd(['compose', '-p', project, '-f', 'docker-compose.yml', '-f', '-', ...args], override.join('\n'));
  try {
    compose('up', '-d', '--no-build', '--pull', 'never');
    const controls = backends.map((service, i) => compose('port', service, String(3001 + i)));
    await delay(6000);
    for (const proxy of proxies) {
      const addr = compose('port', proxy, '80');
      const rr = await observe(addr, '/api', controls);
      assert.ok(rr.hitsOnBusy > 0 && rr.hitsOnBusy < 8, `${proxy} RR control must reach both backends`);
      const wrrAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
      try {
        const ports = [];
        for (let i = 0; i < 8; i++) ports.push((await get(addr, '/api/wrr', wrrAgent)).port);
        assert.equal(ports.filter(port => port === 3001).length, 6);
        assert.equal(ports.filter(port => port === 3002).length, 2);
      } finally { wrrAgent.destroy(); }
      const least = await observe(addr, '/api/least', controls);
      assert.equal(least.hitsOnBusy, 0, `${proxy} should avoid the busy backend during each short probe`);
      console.log(`${proxy}: RR ${rr.hitsOnBusy}/8 on busy ${rr.busyPort}; WRR 6/2; least ${least.hitsOnBusy}/8 on busy ${least.busyPort}`);
    }
    compose('stop', 'backend-1');
    await delay(10000);
    for (const proxy of proxies) {
      const addr = compose('port', proxy, '80');
      for (let i = 0; i < 4; i++) assert.equal((await get(addr, '/api/least', false, 2200)).port, 3002);
      console.log(`${proxy}: failover 4/4 HTTP 200 on backend 2`);
    }
  } finally { compose('down'); }
}

if (process.argv[2] === 'fixture') fixture(Number(process.argv[3]));
else run().catch(error => { console.error(error.message); process.exitCode = 1; });
