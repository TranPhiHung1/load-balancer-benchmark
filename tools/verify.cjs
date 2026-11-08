const fs = require('node:fs');
const path = require('node:path');
const http2 = require('node:http2');
const grpc = require('@grpc/grpc-js');
const loader = require('@grpc/proto-loader');
const assert = require('node:assert/strict');
const api = grpc.loadPackageDefinition(loader.loadSync(path.join(__dirname, '../backend/proto/greeter.proto'))).benchmark;
const ca = fs.readFileSync(path.join(__dirname, '../certs/localhost.crt'));
async function rest(port) {
  const response = await fetch(`http://localhost:${port}/api`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok([3001, 3002].includes(body.port));
  assert.equal(body.message, `Hello from Backend ${body.port - 3000}`);
}
function h2(port) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(`https://localhost:${port}`, { ca });
    const timer = setTimeout(() => { session.destroy(); reject(new Error('HTTP/2 timeout')); }, 5000);
    const finish = error => { clearTimeout(timer); session.close(); error ? reject(error) : resolve(); };
    session.on('error', finish);
    session.on('connect', () => {
      try { assert.equal(session.alpnProtocol, 'h2'); } catch (e) { finish(e); return; }
      const request = session.request({ ':path': '/api' });
      let body = ''; let status;
      request.on('response', headers => { status = headers[':status']; });
      request.on('data', chunk => { body += chunk; });
      request.on('error', finish);
      request.on('end', () => {
        try { assert.equal(status, 200); const json = JSON.parse(body); assert.ok([3001, 3002].includes(json.port)); assert.equal(json.message, `Hello from Backend ${json.port - 3000}`); finish(); } catch (e) { finish(e); }
      });
      request.end();
    });
  });
}
async function unary(address, insecure = false) {
  const seen = new Set();
  // Reuse one client: verify per-RPC distribution over a persistent HTTP/2 channel.
  const client = new api.GreeterService(address, insecure ? grpc.credentials.createInsecure() : grpc.credentials.createSsl(ca));
  try {
    for (let i = 0; i < 40; i++) {
      const reply = await new Promise((resolve, reject) => client.sayHello({ name: 'verify' }, { deadline: Date.now() + 5000 }, (error, value) => error ? reject(error) : resolve(value)));
      assert.equal(reply.message, 'Hello verify');
      assert.ok(['backend-1', 'backend-2'].includes(reply.backend));
      seen.add(reply.backend);
    }
    assert.equal(seen.size, insecure ? 1 : 2, `Distribution: ${[...seen]}`);
    console.log(`PASS gRPC ${address}: ${[...seen].join(', ')}`);
  } finally { client.close(); }
}
(async () => {
  if (process.argv[2] === '--direct') { await unary(process.argv[3], true); return; }
  for (const [i, name] of ['nginx', 'haproxy', 'envoy'].entries()) {
    if (process.argv[2] !== '--grpc-only') {
      await rest(8080 + i); console.log(`PASS ${name} REST`);
      await h2(8440 + i); console.log(`PASS ${name} TLS ALPN=h2, HTTP/2 /api`);
    }
    if (process.argv[2] !== '--http-only') await unary(`localhost:${9440 + i}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
