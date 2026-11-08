// Direct backend regression only; this does not validate any load balancer.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'benchmark/results', `local-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(dir, { recursive: true });
const children = [];
async function ready(port, child, backendPort) {
  for (let i = 0; i < 50; i++) {
    if (child.exitCode !== null) throw new Error(`Backend ${port} exited`);
    try { const res = await fetch(`http://127.0.0.1:${port}/api`, { signal: AbortSignal.timeout(1000) }); const b = await res.json(); assert.equal(res.status, 200); assert.equal(b.port, backendPort); assert.equal(b.message, `Hello from Backend ${backendPort - 3000}`); return; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error(`Backend ${port} not ready`);
}
(async () => {
  for (const i of [1, 2]) {
    const child = spawn(process.execPath, [`backend/backend-${i}/server.js`], { cwd: root, env: { ...process.env, REST_PORT: String(13000 + i), GRPC_PORT: String(15050 + i) }, windowsHide: true });
    children.push(child);
    child.stdout.on('data', data => fs.appendFileSync(path.join(dir, `backend-${i}.txt`), data));
    child.stderr.on('data', data => fs.appendFileSync(path.join(dir, `backend-${i}.txt`), data));
    await ready(13000 + i, child, 3000 + i);
    const verify = spawnSync(process.execPath, ['tools/verify.cjs', '--direct', `localhost:${15050 + i}`], { cwd: root, encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(dir, `grpc-${i}.txt`), verify.stdout + verify.stderr);
    assert.equal(verify.status, 0, verify.stdout + verify.stderr);
    console.log(verify.stdout.trim());
    const grpcResult = spawnSync('k6', ['run', '--no-thresholds', '--vus=2', '--duration=2s', `--summary-export=${path.join(dir, `backend-${i}-grpc.json`)}`, '-e', `GRPC_ADDR=localhost:${15050 + i}`, '-e', 'PLAINTEXT=true', 'benchmark/grpc-unary.js'], { cwd: root, encoding: 'utf8', windowsHide: true });
    fs.writeFileSync(path.join(dir, `backend-${i}-grpc-k6.txt`), (grpcResult.stdout || '') + (grpcResult.stderr || ''));
    assert.equal(grpcResult.status, 0, grpcResult.stderr);
    const grpcSummary = JSON.parse(fs.readFileSync(path.join(dir, `backend-${i}-grpc.json`))).metrics;
    assert.equal((grpcSummary.checks.values || grpcSummary.checks).fails, 0);
    const errorRate = grpcSummary.workload_errors.values || grpcSummary.workload_errors;
    assert.equal(errorRate.rate ?? errorRate.value, 0);
    console.log(`PASS backend-${i} k6 gRPC: 2 VUs / 2s, direct h2c; LB distribution thresholds disabled`);
    for (const [name, script, extra] of [['rest', 'rest-api', []], ['keepalive-on', 'keep-alive', ['-e', 'KEEP_ALIVE=on']], ['keepalive-off', 'keep-alive', ['-e', 'KEEP_ALIVE=off']]]) {
      const result = spawnSync('k6', ['run', '--vus=2', '--duration=2s', `--summary-export=${path.join(dir, `backend-${i}-${name}.json`)}`, '-e', `BASE_URL=http://localhost:${13000 + i}`, ...extra, `benchmark/${script}.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
      fs.writeFileSync(path.join(dir, `backend-${i}-${name}.txt`), (result.stdout || '') + (result.stderr || ''));
      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(fs.readFileSync(path.join(dir, `backend-${i}-${name}.json`)));
      const m = summary.metrics.checks.values || summary.metrics.checks;
      assert.equal(m.fails, 0);
      console.log(`PASS backend-${i} ${name}: 2 VUs / 2s, direct only`);
    }
  }
  fs.writeFileSync(path.join(dir, 'scope.txt'), 'PASS: direct gRPC 40 RPC/backend, plus k6 gRPC 2 VUs/2s/backend with --no-thresholds (single backend); REST and original Keep-Alive on/off scripts at 2 VUs/2s/backend. No load balancer, TLS, HTTP/2 listener or 10 VUs/30s benchmark validated.');
  console.log(`Evidence: ${dir}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { for (const child of children) child.kill(); });
