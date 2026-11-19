const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createServer } = require('./server.cjs');
const { createDockerAdapter, markers } = require('./failover.cjs');
const { createBenchmarkRunner } = require('./benchmark-runner.cjs');
const { createFullBenchmarkRunner } = require('./full-benchmark-runner.cjs');

const repo = path.resolve(__dirname, '..');
const backends = ['backend-1', 'backend-2'];
const containerIds = { 'backend-1': 'a'.repeat(64), 'backend-2': 'b'.repeat(64) };

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'lb-failover-test-')));
  const states = { 'backend-1': 'running', 'backend-2': 'running' };
  const changes = [];
  const flags = { benchmark: false, offline: false, foreign: false, httpUnavailable: false };
  const docker = {
    async inspect(name) {
      if (flags.offline) throw Object.assign(Error('Docker offline'), { status: 503 });
      return {
        Name: '/' + name,
        Id: containerIds[name],
        State: { Status: states[name], Running: states[name] === 'running' },
        Config: { Labels: {
          'com.docker.compose.project': 'lab',
          'com.docker.compose.service': name,
          'com.docker.compose.project.working_dir': flags.foreign && name === backends[0] ? os.tmpdir() : repo,
          'com.docker.compose.project.config_files': path.join(repo, 'docker-compose.yml'),
        } },
      };
    },
    async change(action, id) {
      const name = backends.find(key => containerIds[key] === id);
      changes.push([action, name]);
      if (action === 'stop' && flags.onStop) await flags.onStop();
      states[name] = action === 'start' ? 'running' : 'exited';
      if (flags.ambiguousStop && action === 'stop') throw Object.assign(Error('Docker timeout'), { status: 503 });
    },
  };
  const probe = async port => {
    if (port === 8080 && flags.failTraffic) return { status: 503, backend: null, ms: 5, error: 'HTTP 503' };
    const name = port === 3001 ? backends[0] : port === 3002 ? backends[1] : backends.find(id => states[id] === 'running');
    return states[name] === 'running' && !(flags.httpUnavailable && name === backends[1])
      ? { status: 200, backend: name, ms: 2, error: null }
      : { status: null, backend: null, ms: 2, error: 'ECONNREFUSED' };
  };
  const benchmark = {
    active: () => flags.benchmark, snapshot: () => null,
    start() { flags.benchmark = true; return { id: 'mock-benchmark' }; },
  };
  const servers = [];
  t.after(async () => {
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    for (const marker of Object.values(markers(root))) await fs.unlink(marker).catch(() => {});
    await fs.rmdir(root);
  });
  async function connect() {
    const server = createServer({ benchmarkRunner: benchmark, failoverRoot: root, docker, failoverProbe: probe, failoverDelay: async () => {} });
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    return {
      get: endpoint => fetch(url + endpoint),
      post: (action, body, extraHeaders = {}, prefix = 'failover') => fetch(url + '/api/' + prefix + '/' + action, {
        method: 'POST', body: JSON.stringify(body),
        headers: { Origin: url, 'Content-Type': 'application/json', 'X-Dashboard-Action': prefix, ...extraHeaders },
      }),
    };
  }
  return { root, states, changes, flags, connect };
}

const input = (backend = 'backend-1') => ({ balancer: 'nginx', backend, confirmed: true });

test('Failover API rejects invalid targets, unsafe requests and foreign Compose containers', async t => {
  const lab = await fixture(t);
  const client = await lab.connect();
  assert.equal((await client.post('stop', input('nginx'))).status, 400);
  assert.equal((await client.post('stop', { ...input(), confirmed: false })).status, 400);
  assert.equal((await client.post('stop', { ...input(), cmd: 'anything' })).status, 400);
  assert.equal((await client.post('stop', { ...input(), cmd: 'a'.repeat(600) })).status, 413);
  assert.equal((await client.post('stop', input(), { Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await client.post('stop', input(), { Origin: '' })).status, 403);
  assert.equal((await client.post('stop', input(), { 'X-Dashboard-Action': 'demo' })).status, 403);
  lab.flags.foreign = true;
  assert.equal((await client.post('stop', input())).status, 409);
  assert.deepEqual(lab.changes, []);
});

test('One backend at a time, failed requests retained, and recovery works across server instances', async t => {
  const lab = await fixture(t);
  const client = await lab.connect();
  const peer = await lab.connect();
  assert.equal((await client.post('stop', input())).status, 200);
  assert.equal((await peer.post('stop', input('backend-2'))).status, 409);
  assert.equal((await peer.post('start', { workload: 'rest', balancer: 'nginx', confirmed: true }, {}, 'benchmark')).status, 409);
  const status = await (await peer.get('/api/failover/status?balancer=nginx')).json();
  assert.equal(status.session, true);
  assert.deepEqual(status.backends.map(item => [item.docker, item.http.status, item.containerHealth]), [['exited', null, null], ['running', 200, null]]);
  lab.flags.failTraffic = true;
  const failed = await (await peer.post('requests', { balancer: 'nginx', count: 10 })).json();
  assert.equal(failed.rows.length, 10);
  assert.ok(failed.rows.every(row => row.status === 503 && row.backend === null));
  lab.flags.failTraffic = false;
  const routed = await (await peer.post('requests', { balancer: 'nginx', count: 20 })).json();
  assert.ok(routed.rows.every(row => row.backend === 'backend-2' && row.status === 200));
  assert.equal((await peer.post('recovery', { balancer: 'nginx' })).status, 409);
  assert.equal((await peer.post('restore', input())).status, 200);
  assert.equal((await peer.post('recovery', { balancer: 'nginx' })).status, 200);
  assert.equal((await peer.post('start', {}, {}, 'benchmark')).status, 202);
  assert.deepEqual(lab.changes, [['stop', 'backend-1'], ['start', 'backend-1']]);
});

test('Benchmark and peer health block stop, but benchmark does not block restore', async t => {
  const lab = await fixture(t);
  const client = await lab.connect();
  lab.flags.httpUnavailable = true;
  assert.equal((await client.post('stop', input())).status, 409);
  lab.flags.httpUnavailable = false;
  lab.flags.benchmark = true;
  assert.equal((await client.post('stop', input())).status, 409);
  lab.states['backend-1'] = 'exited';
  assert.equal((await client.post('restore', input())).status, 200);
  assert.deepEqual(lab.changes, [['start', 'backend-1']]);
  await fs.writeFile(path.join(lab.root, '.benchmark.lock'), 'test lock');
  lab.flags.benchmark = false;
  try { assert.equal((await client.post('stop', input())).status, 409); }
  finally { await fs.unlink(path.join(lab.root, '.benchmark.lock')); }
});

test('Concurrent requests cannot stop the second backend or restore during an unfinished stop', async t => {
  const lab = await fixture(t);
  const client = await lab.connect();
  const peer = await lab.connect();
  let blocked;
  const remaining = new Promise(resolve => { blocked = resolve; });
  let reached;
  const stopping = new Promise(resolve => { reached = resolve; });
  lab.flags.onStop = () => { reached(); return remaining; };
  const first = client.post('stop', input());
  await stopping;
  try {
    assert.equal((await peer.post('stop', input('backend-2'))).status, 409);
    assert.equal((await peer.post('restore', input())).status, 409);
    assert.equal((await peer.post('start', {}, {}, 'benchmark')).status, 409);
  } finally { blocked(); }
  assert.equal((await first).status, 200);
  assert.deepEqual(lab.changes, [['stop', 'backend-1']]);
});

test('Docker offline is distinct from HTTP health and uncertain stop keeps the safety lease', async t => {
  const lab = await fixture(t);
  const client = await lab.connect();
  lab.flags.offline = true;
  const offline = await (await client.get('/api/failover/status?balancer=nginx')).json();
  assert.ok(offline.backends.every(state => state.docker === 'unknown' && state.http.status === 200));
  assert.equal((await client.post('stop', input())).status, 503);
  lab.flags.offline = false;
  lab.flags.ambiguousStop = true;
  assert.equal((await client.post('stop', input())).status, 503);
  const recovered = await (await client.get('/api/failover/status?balancer=nginx')).json();
  assert.equal(recovered.session, true);
  assert.equal(recovered.backends[0].docker, 'exited');
  assert.equal((await client.post('restore', input())).status, 200);
});

test('Both runners reject a failover lease before spawning k6', async t => {
  const lab = await fixture(t);
  const spawn = () => assert.fail('k6 must never start');
  await fs.writeFile(markers(lab.root).lease, '');
  const web = createBenchmarkRunner({ root: lab.root, findK6: async () => 'mock-k6', checkTarget: async () => {}, spawn });
  const full = createFullBenchmarkRunner({ root: lab.root, findK6: async () => assert.fail('preflight must not start'), spawn });
  await assert.rejects(web.start({ balancer: 'nginx', workload: 'rest', confirmed: true }), error => error.status === 409);
  await assert.rejects(full.run(), error => error.status === 409);
});

test('Docker adapter uses the local socket and rejects arbitrary actions or targets', async () => {
  const commands = [];
  const adapter = createDockerAdapter(async (exe, args, options) => {
    commands.push({ exe, args, options });
    return { stdout: JSON.stringify([{ Id: containerIds['backend-1'] }]) };
  });
  await assert.rejects(adapter.inspect('nginx'));
  await assert.rejects(adapter.change('rm', containerIds['backend-1']));
  await assert.rejects(adapter.change('stop', 'backend-1'));
  await assert.rejects(adapter.change('stop', containerIds['backend-1']));
  await adapter.inspect('backend-1');
  await adapter.change('stop', containerIds['backend-1']);
  assert.equal(commands.length, 2);
  assert.equal(commands[0].exe, 'docker');
  assert.match(commands[0].args[1], /^(npipe|unix):/);
  assert.deepEqual(commands[0].args.slice(2), ['container', 'inspect', 'backend-1']);
  assert.deepEqual(commands[1].args.slice(2), ['container', 'stop', '--time', '3', containerIds['backend-1']]);
  assert.equal(commands[1].options.shell, false);
  assert.equal(commands[1].options.timeout, 8000);
});
