// Run from the repository with Docker Compose and the lab images available.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const { networkInterfaces } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const proxies = ['nginx', 'haproxy', 'envoy'];
const clients = ['client-a', 'client-b', 'client-c', 'client-d'];
const backends = ['backend-1', 'backend-2'];
const requests = 6;

function request(host, index) {
  return new Promise((resolve, reject) => {
    const headers = { Connection: 'close' };
    if (index % 2 === 1) {
      // Negative control only. These headers must not change the observed source or affinity.
      headers['X-Forwarded-For'] = `198.51.100.${index}`;
      headers['X-Lab-Source-IP'] = `203.0.113.${index}`;
    }
    http.get({ hostname: host, path: '/api/iphash', agent: false, headers, signal: AbortSignal.timeout(3000) }, res => {
      let body = '';
      res.setEncoding('utf8').on('data', chunk => body += chunk);
      res.on('error', reject);
      res.on('end', () => {
        try {
          assert.equal(res.statusCode, 200);
          resolve({ source: res.headers['x-lab-source-ip'], port: JSON.parse(body).port });
        } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

async function client() {
  const addresses = Object.values(networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal);
  assert.equal(addresses.length, 1);
  const ip = addresses[0].address;
  const mapping = {};
  for (const proxy of proxies) {
    const rows = [];
    for (let i = 0; i < requests; i++) rows.push(await request(proxy, i));
    assert.ok(rows.every(row => row.source === ip), `${proxy} must report the direct source ${ip}`);
    assert.ok([3001, 3002].includes(rows[0].port));
    assert.ok(rows.every(row => row.port === rows[0].port), `${proxy} must preserve affinity for ${ip}`);
    mapping[proxy] = rows[0].port;
  }
  console.log(JSON.stringify({ ip, mapping }));
}

async function run() {
  const docker = process.env.IPHASH_TEST_DOCKER || 'docker';
  const root = path.join(__dirname, '..');
  const cmd = (args, input) => execFileSync(docker, args, { cwd: root, encoding: 'utf8', input, timeout: 45000 }).trim();
  const project = 'iphash-test-' + randomBytes(4).toString('hex');
  const images = backends.map(service => cmd(['inspect', '--format', '{{.Image}}', service]));
  const override = ['services:'];
  for (const [i, service] of backends.entries()) override.push(
    `  ${service}:`, `    container_name: ${project}-${service}`, `    image: ${images[i]}`, '    ports: !reset []');
  const networks = ['default', 'second', 'third'];
  for (const proxy of proxies) override.push(
    `  ${proxy}:`, `    container_name: ${project}-${proxy}`,
    '    ports: !reset []', `    networks: [${networks.join(', ')}]`);
  for (const [i, name] of clients.entries()) override.push(
    `  ${name}:`, `    image: ${images[0]}`, '    entrypoint: ["node", "-e", "setInterval(() => {}, 60000)"]',
    '    command: []', `    networks: [${networks[Math.max(0, i - 1)]}]`,
    '    volumes: ["./tools/test-iphash.cjs:/iphash-test.cjs:ro"]');
  override.push('networks:', '  second: {}', '  third: {}');
  const compose = (...args) => cmd(['compose', '-p', project, '-f', 'docker-compose.yml', '-f', '-', ...args], override.join('\n'));
  const observe = phase => {
    const mappings = clients.map(name => JSON.parse(compose('exec', '-T', name, 'node', '/iphash-test.cjs', 'client')));
    assert.equal(new Set(mappings.map(row => row.ip)).size, clients.length, 'Clients must have distinct real IPs');
    assert.ok(new Set(mappings.map(row => row.ip.split('.').slice(0, 3).join('.'))).size > 1, 'Exercise multiple Nginx IPv4 hash prefixes');
    console.log(phase, JSON.stringify(mappings));
    return mappings;
  };
  try {
    compose('up', '-d', '--no-build', '--pull', 'never');
    await delay(7000);
    const baseline = observe('healthy');
    // Prefer one outage if it covers every proxy; otherwise exercise both separately.
    const coversAll = port => proxies.every(proxy => baseline.some(row => row.mapping[proxy] === port));
    const outages = coversAll(3001) ? [3001] : coversAll(3002) ? [3002] : [3001, 3002];
    for (const stopped of outages) {
      const service = backends[stopped - 3001];
      compose('stop', service);
      await delay(12000);
      const failed = observe(`without ${service}`);
      assert.deepEqual(failed.map(row => row.ip), baseline.map(row => row.ip));
      const surviving = stopped === 3001 ? 3002 : 3001;
      assert.ok(failed.every(row => Object.values(row.mapping).every(port => port === surviving)));
      compose('start', service);
      await delay(12000);
      const restored = observe(`restored ${service}`);
      assert.deepEqual(restored.map(row => row.ip), baseline.map(row => row.ip));
      for (const proxy of proxies) {
        const same = restored.filter((row, i) => row.mapping[proxy] === baseline[i].mapping[proxy]).length;
        console.log(`${proxy}: ${same}/${clients.length} original mappings after recovery`);
      }
    }
  } finally { compose('down'); }
}

(process.argv[2] === 'client' ? client() : run()).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
