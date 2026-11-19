const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const tls = require('node:tls');
const { spawn } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const { normalize, BALANCERS, WORKLOADS } = require('./results.cjs');
const { assertNoFailover } = require('./failover.cjs');
const {createResourceMonitor,CONTAINERS,summarize}=require('./resource-monitor.cjs');
const REPO = path.resolve(__dirname, '..');
const OUTPUT = path.join(__dirname, 'results');
const SCRIPTS = Object.freeze({ rest: 'rest-api.js', 'keepalive-on': 'keep-alive.js', 'keepalive-off': 'keep-alive.js', http2: 'http2.js', grpc: 'grpc-unary.js' });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function findK6() {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const file = path.resolve(dir.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'k6.exe' : 'k6');
    try { const stat = await fs.stat(file); if (stat.isFile()) { await fs.access(file, process.platform === 'win32' ? 0 : 1); return file; } } catch { /* try next PATH directory */ }
  }
  throw fail('Không tìm thấy k6 trong PATH. Cài k6 rồi khởi động lại Dashboard.', 503);
}
async function scriptConfig(workload) {
  if (!WORKLOADS.includes(workload)) throw fail('Loại kiểm thử không hợp lệ');
  const script = path.join(REPO, 'benchmark', SCRIPTS[workload]);
  const source = await fs.readFile(script, 'utf8');
  const vus = Number(source.match(/\bvus\s*:\s*(\d+)/)?.[1]);
  const duration = source.match(/\bduration\s*:\s*['"](\d+s)['"]/)?.[1];
  if (!vus || !duration) throw fail('Không đọc được VUs/duration cố định trong script. Không chạy với thông số suy đoán.', 503);
  return { script, vus, duration, sha256: createHash('sha256').update(source).digest('hex') };
}
function argumentsFor(balancer, workload, summary, config) {
  const index = BALANCERS.indexOf(balancer);
  if (index < 0 || !WORKLOADS.includes(workload)) throw fail('Lựa chọn không hợp lệ');
  const target = workload === 'grpc' ? `GRPC_ADDR=localhost:${9440 + index}` : `BASE_URL=${workload === 'http2' ? 'https' : 'http'}://localhost:${(workload === 'http2' ? 8440 : 8080) + index}`;
  const args = ['run', '--summary-trend-stats=avg,min,med,max,p(90),p(95)', `--summary-export=${summary}`, '-e', target];
  if (workload.startsWith('keepalive-')) args.push('-e', 'KEEP_ALIVE=' + (workload === 'keepalive-on' ? 'on' : 'off'));
  args.push(config.script);
  return args;
}
async function checkTarget(balancer, workload) {
  const index = BALANCERS.indexOf(balancer);
  if (index < 0) throw fail('Load Balancer không hợp lệ');
  if (workload === 'http2' || workload === 'grpc') {
    const ca = await fs.readFile(path.join(REPO, 'certs/localhost.crt'));
    await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: (workload === 'grpc' ? 9440 : 8440) + index, servername: 'localhost', ca, ALPNProtocols: ['h2'] });
      const timer = setTimeout(() => socket.destroy(new Error('Timeout kết nối TLS')), 2500);
      socket.once('secureConnect', () => { clearTimeout(timer); const ok = socket.alpnProtocol === 'h2'; socket.destroy(); ok ? resolve() : reject(new Error('Listener không thương lượng HTTP/2')); });
      socket.once('error', e => { clearTimeout(timer); reject(e); });
    });
    return;
  }
  await new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port: 8080 + index, path: '/api', agent: false }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(new Error('Response quá lớn')); });
      res.on('error', reject);
      res.on('end', () => {
        clearTimeout(timer);
        try { const data = JSON.parse(body); if (res.statusCode !== 200 || ![3001, 3002].includes(data.port)) throw new Error('HTTP /api không hợp lệ'); resolve(); } catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('Timeout HTTP /api')), 2500);
    req.on('error', e => { clearTimeout(timer); reject(e); });
  });
}
function cleanEnvironment() {
  // Prevent shell/user environment from silently overriding the checked scripts.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^K6_/i.test(key) && !['BASE_URL','GRPC_ADDR','PLAINTEXT','KEEP_ALIVE'].includes(key.toUpperCase())));
}
function createBenchmarkRunner(options = {}) {
  const root = options.root || OUTPUT, locate = options.findK6 || findK6, preflight = options.checkTarget || checkTarget;
  const launch = options.spawn || spawn, timeoutMs = options.timeoutMs || 90000;
  const monitorFactory=options.monitorFactory || createResourceMonitor;
  let resourceMonitor=null;
  let current = null, reserved = false, child = null, lock = null, shuttingDown = false;
  const active = () => reserved || current?.state === 'running';
  const snapshot = () => current ? JSON.parse(JSON.stringify(current)) : null;
  const save = async file => {
    const temp = path.join(current.directory, file + '.tmp');
    const data = file === 'runs.json' ? current.runs : { ...current, logs: undefined, resources:undefined };
    await fs.writeFile(temp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(temp, path.join(current.directory, file));
  };
  async function release() {
    if (lock) { await lock.close(); lock = null; await fs.unlink(path.join(root, '.benchmark.lock')); }
  }
  async function execute(executable, args, logfile,balancer) {
    const log = await fs.open(logfile, 'wx');
    let pendingWrites = Promise.resolve(), writeError = null;
    const append = (kind, data) => {
      const text = data.toString();
      current.logs = (current.logs + `[${kind}] ${text}`).slice(-65536);
      pendingWrites = pendingWrites.then(() => log.write(`[${kind}] ${text}`)).catch(e => { writeError = e; child?.kill(); });
    };
    try {
      if (current.cancelRequested) return { exitCode:null,error:'Đã dừng trước khi tạo tiến trình k6' };
      try {resourceMonitor=monitorFactory({jobId:current.id,balancer,workload:current.workload});}
      catch(e){
        const data={jobId:current.id,balancer,workload:current.workload,container:CONTAINERS[balancer],state:'error',startedAt:null,finishedAt:null,samples:[],errors:[{message:e.message}],summary:summarize([])};
        resourceMonitor={data,start:()=>{data.startedAt=new Date().toISOString();},stop:async()=>{if(!data.finishedAt)data.finishedAt=new Date().toISOString();return data;}};
      }
      current.resources.measurements.push(resourceMonitor.data);
      return await new Promise(resolve => {
        let expired = false, spawnError = null, forceTimer;
        try { child = launch(executable, args, { cwd: REPO, env: cleanEnvironment(), shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe'] }); }
        catch (e) { return resolve({ exitCode: null, error: e.message }); }
        child.once('spawn',()=>{if(!current.cancelRequested)resourceMonitor?.start();});
        const timer = setTimeout(() => { expired = true; void resourceMonitor?.stop(); child.kill('SIGINT'); forceTimer = setTimeout(() => child?.kill('SIGKILL'), 3000); }, timeoutMs);
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', data => append('stdout', data));
        child.stderr.on('data', data => append('stderr', data));
        child.once('error', e => { spawnError = e.message; });
        child.once('close', (code, signal) => {
          void resourceMonitor?.stop();
          clearTimeout(timer); clearTimeout(forceTimer); child = null;
          resolve({ exitCode: code, signal, error: expired ? 'Vượt giới hạn thời gian 90 giây/bài' : spawnError, timedOut: expired });
        });
      });
    } finally {
      if(resourceMonitor){await resourceMonitor.stop();resourceMonitor=null;}
      await pendingWrites; await log.close();
      if (writeError) throw writeError;
    }
  }
  async function work(executable, config) {
    try {
      for (const balancer of current.balancers) {
        if (current.cancelRequested) break;
        const began = new Date().toISOString();
        const summary = path.join(current.directory, `${balancer}-${current.workload}.json`);
        const run = { balancer, workload: current.workload, summary, startedAt: began, vus: config.vus, duration: config.duration, status: 'FAIL', exitCode: null };
        current.currentBalancer = balancer;
        current.logs += `\n--- ${balancer} / ${current.workload} ---\n`;
        try {
          await preflight(balancer, current.workload);
          if (current.cancelRequested) break;
          const args = argumentsFor(balancer, current.workload, summary, config);
          run.arguments = args;
          Object.assign(run, await execute(executable, args, path.join(current.directory, `${balancer}-${current.workload}.log`),balancer));
          if (!run.error && !current.cancelRequested) {
            const data = JSON.parse((await fs.readFile(summary, 'utf8')).replace(/^\uFEFF/, ''));
            const normalized = normalize(data, current.workload, run.exitCode);
            run.status = normalized.status === 'PASS' ? 'PASS' : 'FAIL';
            if (run.status !== 'PASS') run.error = 'Kết quả không đạt hoặc thiếu bằng chứng PASS';
          }
        } catch (e) { run.error = e.message; }
        if (current.cancelRequested) { run.status = 'FAIL'; run.error = 'Đã dừng theo yêu cầu'; }
        run.finishedAt = new Date().toISOString();
        current.runs.push(run); current.completed = current.runs.length;
        if (run.error) current.logs = (current.logs + '\n[Lỗi] ' + run.error + '\n').slice(-65536);
        await save('runs.json'); await save('metadata.json');
      }
      current.state = !current.cancelRequested && current.runs.length === current.total && current.runs.every(r => r.status === 'PASS') ? 'success' : 'failed';
      current.error = current.cancelRequested ? 'Đã dừng theo yêu cầu; giữ nguyên log và kết quả đã có.' : current.runs.find(r => r.error)?.error || null;
    } catch (e) { current.state = 'failed'; current.error = 'Không lưu/đọc được kết quả: ' + e.message; }
    finally {
      current.finishedAt = new Date().toISOString(); current.currentBalancer = null;
      try{await fs.writeFile(path.join(current.directory,'resource-metrics.json'),JSON.stringify(current.resources,null,2),{encoding:'utf8',flag:'wx'});}
      catch(e){current.resourceError='Không lưu được dữ liệu tài nguyên: '+e.message;}
      try { await save('metadata.json'); } catch (e) { current.error = 'Không ghi được metadata: ' + e.message; current.state = 'failed'; }
      try { await release(); } catch (e) { current.error = 'Không giải phóng được khóa: ' + e.message; current.state = 'failed'; }
      reserved = false;
    }
  }
  async function start(input) {
    if (shuttingDown) throw fail('Dashboard đang dừng',503);
    if (!input || !Object.keys(input).every(k => ['balancer','workload','confirmed'].includes(k)) || ![...BALANCERS,'all'].includes(input.balancer) || !WORKLOADS.includes(input.workload) || input.confirmed !== true) throw fail('Cần xác nhận và lựa chọn Load Balancer/workload hợp lệ');
    if (active()) throw fail('Một benchmark đang chạy hoặc đang kiểm tra điều kiện', 409);
    reserved = true;
    try {
      const executable = await locate(), config = await scriptConfig(input.workload);
      const balancers = input.balancer === 'all' ? [...BALANCERS] : [input.balancer];
      for (const balancer of balancers) {
        try { await preflight(balancer,input.workload); } catch (e) { throw fail(`${balancer} không sẵn sàng: ${e.message}`,503); }
      }
      if (shuttingDown) throw fail('Dashboard đang dừng',503);
      await fs.mkdir(root, { recursive:true });
      try { lock = await fs.open(path.join(root,'.benchmark.lock'),'wx'); await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})); }
      catch (e) { if (e.code === 'EEXIST') throw fail('Benchmark đang chạy ở Dashboard khác hoặc còn khóa của phiên bị ngắt. Xem hướng dẫn xử lý khóa.',409); throw e; }
      await assertNoFailover(root);
      const id = 'web-' + new Date().toISOString().replace(/[:.]/g,'-') + '-' + randomUUID().slice(0,8);
      const directory = path.join(root,id); await fs.mkdir(directory);
      if (shuttingDown) throw fail('Dashboard đang dừng',503);
      current = { id, directory, producer:'lb-benchmark-dashboard', state:'running', workload:input.workload, balancers, currentBalancer:null, total:balancers.length, completed:0,
        startedAt:new Date().toISOString(), finishedAt:null, vus:config.vus, duration:config.duration, script:path.relative(REPO,config.script), scriptSha256:config.sha256, executable, timeoutMs,
        cancelRequested:false, logs:'', runs:[], error:null,resourceError:null,
        resources:{schemaVersion:1,jobId:id,workload:input.workload,cpuUnit:'%',memoryUnit:'MiB',measurements:[]} };
      await save('runs.json'); await save('metadata.json');
      void work(executable,config);
      return snapshot();
    } catch (e) { if (current?.state === 'running') { current.state='failed'; current.error=e.message; } try { await release(); } finally { reserved=false; } throw e; }
  }
  function stop() {
    if (!current || current.state !== 'running') throw fail('Không có benchmark đang chạy',409);
    current.cancelRequested = true;
    void resourceMonitor?.stop();
    if (child) {
      child.kill('SIGINT');
      const runningChild = child;
      const timer = setTimeout(() => { if (child === runningChild) child.kill('SIGKILL'); },3000);
      timer.unref();
    }
    return snapshot();
  }
  async function config() {
    let k6, error;
    try { k6 = await locate(); } catch (e) { error = e.message; }
    const workloads = [];
    for (const id of WORKLOADS) {
      try { const c = await scriptConfig(id); workloads.push({id,vus:c.vus,duration:c.duration}); }
      catch (e) { workloads.push({id,error:e.message}); }
    }
    return { available:!!k6, executable:k6 || null, error:error || null, workloads };
  }
  const shutdown = () => { shuttingDown = true; if (current?.state === 'running') stop(); };
  return { start, stop, snapshot, active, config, shutdown };
}
module.exports = { createBenchmarkRunner, findK6, scriptConfig, argumentsFor, checkTarget, cleanEnvironment, OUTPUT };
