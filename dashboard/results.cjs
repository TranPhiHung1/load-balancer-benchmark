const fs = require('node:fs/promises');
const path = require('node:path');
const {validateResourceData}=require('./resource-monitor.cjs');
const {validFullMetadata}=require('./full-run-schema.cjs');
const {applyBenchmarkPolicy}=require('./benchmark-policy.cjs');
const ROOT = path.resolve(__dirname, '../benchmark/results');
const BALANCERS = ['nginx', 'haproxy', 'envoy'];
const WORKLOADS = ['rest', 'keepalive-on', 'keepalive-off', 'http2', 'grpc'];
const finite = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
function normalize(data, workload, exitCode) {
  if (!data || !data.metrics || typeof data.metrics !== 'object') throw new Error('Thiếu metrics k6');
  const metric = name => data.metrics[name]?.values || data.metrics[name] || {};
  const count = metric(workload === 'grpc' ? 'unary_requests' : 'http_reqs');
  const latency = metric(workload === 'grpc' ? 'grpc_req_duration' : 'http_req_duration');
  const errors = metric(['grpc', 'http2'].includes(workload) ? 'workload_errors' : 'http_req_failed');
  const checks = metric('checks');
  const errorRate = finite(errors.value ?? errors.rate);
  const total = finite(count.count);
  const failed = (typeof exitCode === 'number' && exitCode !== 0) || (finite(checks.fails) !== null && checks.fails > 0) || (errorRate !== null && errorRate > 0) || total === 0;
  // Legacy k6 export: threshold boolean means FAILED; modern export: { ok }.
  const thresholdFailed = Object.values(data.metrics).some(m => Object.values(m.thresholds || {}).some(t => t === true || t?.ok === false));
  const proven = exitCode === 0 && total > 0 && finite(checks.fails) === 0 && finite(checks.passes) > 0 && errorRate === 0;
  return { rps: finite(count.rate), avg: finite(latency.avg), p95: finite(latency['p(95)']), errorRate, total,
    checks: finite(checks.passes) !== null && finite(checks.fails) !== null ? checks.passes + checks.fails : null,
    status: failed || thresholdFailed ? 'FAIL' : proven ? 'PASS' : 'N/A', exitCode: finite(exitCode) };
}
async function loadResults(root = ROOT, sourcePrefix = 'benchmark/results') {
  const batches = [], warnings = [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (e) { return { batches, warnings: ['Không đọc được thư mục benchmark/results: ' + e.code] }; }
  const directories = [{ name: '.', isDirectory: () => true }, ...entries.filter(e => e.isDirectory() && !e.isSymbolicLink())];
  for (const entry of directories) {
    const dir = path.join(root, entry.name), rows = [];
    let files;
    try { files = await fs.readdir(dir, { withFileTypes: true }); } catch { continue; }
    let metadata = [], jobMetadata = null, resources=null,resourceError=null;
    if(sourcePrefix==='dashboard/results' && files.some(f=>f.name==='resource-metrics.json' && f.isFile() && !f.isSymbolicLink())){
      try{
        const resourceFile=path.join(dir,'resource-metrics.json');
        if((await fs.stat(resourceFile)).size>4*1024*1024)throw Error('File tài nguyên quá lớn');
        const parsed=await readJSON(resourceFile);
        resources=validateResourceData(parsed,entry.name);
      }catch(e){resourceError='Không đọc được dữ liệu tài nguyên: '+e.message;warnings.push(`${entry.name}: ${resourceError}`);}
    }
    if (sourcePrefix === 'dashboard/results' && files.some(f=>f.name==='metadata.json' && f.isFile() && !f.isSymbolicLink())) {
      try { jobMetadata = await readJSON(path.join(dir,'metadata.json')); }
      catch { warnings.push(`${entry.name}/metadata.json: JSON không hợp lệ`); }
    }
    if (files.some(f => f.name === 'runs.json' && f.isFile() && !f.isSymbolicLink())) {
      try { const d = await readJSON(path.join(dir, 'runs.json')); metadata = (Array.isArray(d) ? d : [d]).filter(m => m && typeof m === 'object'); }
      catch { warnings.push(`${entry.name}/runs.json: JSON không hợp lệ`); }
    }
    // Root legacy files are partitioned by suffix, never merged into a run.
    const groups = new Map();
    for (const file of files) {
      if (!file.isFile() || file.isSymbolicLink()) continue;
      const match = /^(nginx|haproxy|envoy)-(rest|keepalive-on|keepalive-off|http2|grpc)(-v\d+)?\.json$/.exec(file.name);
      if (!match) continue;
      const [, balancer, workload, suffix = ''] = match;
      const group = entry.name === '.' ? `legacy${suffix || '-original'}` : entry.name;
      if (!groups.has(group)) groups.set(group, []);
      const source = path.posix.join(sourcePrefix, entry.name === '.' ? '' : entry.name, file.name);
      const meta = metadata.find(m => m.balancer === balancer && m.workload === workload);
      try {
        const normalized = normalize(await readJSON(path.join(dir, file.name)), workload, meta?.exitCode);
        if (meta?.status === 'FAIL') normalized.status = 'FAIL';
        groups.get(group).push({ balancer, workload, source, ...normalized });
      }
      catch { warnings.push(`${source}: JSON không hợp lệ hoặc thiếu metrics`); groups.get(group).push({ balancer, workload, source, status: meta?.status === 'FAIL' ? 'FAIL' : 'N/A', issue: 'Không đọc được JSON' }); }
    }
    if (sourcePrefix === 'dashboard/results') {
      for (const meta of metadata) {
        if (!BALANCERS.includes(meta.balancer) || !WORKLOADS.includes(meta.workload)) continue;
        if (!groups.has(entry.name)) groups.set(entry.name,[]);
        const data = groups.get(entry.name);
        if (!data.some(r => r.balancer === meta.balancer && r.workload === meta.workload)) data.push({balancer:meta.balancer,workload:meta.workload,status:meta.status === 'FAIL' ? 'FAIL' : 'N/A',source:path.posix.join(sourcePrefix,entry.name,'runs.json'),issue:meta.error || 'Không có summary'});
      }
      if (jobMetadata?.state === 'failed' && Array.isArray(jobMetadata.balancers) && WORKLOADS.includes(jobMetadata.workload)) {
        if (!groups.has(entry.name)) groups.set(entry.name,[]);
        const data=groups.get(entry.name);
        for(const balancer of jobMetadata.balancers.filter(b=>BALANCERS.includes(b))) {
          if (!data.some(r=>r.balancer===balancer && r.workload===jobMetadata.workload)) data.push({balancer,workload:jobMetadata.workload,status:'N/A',source:path.posix.join(sourcePrefix,entry.name,'metadata.json'),issue:'Bài chưa thực hiện hoặc bị dừng trước khi có summary'});
        }
      }
      if(jobMetadata?.state==='failed' && validFullMetadata(jobMetadata,path.resolve(__dirname,'..'))){
        if(!groups.has(entry.name))groups.set(entry.name,[]);
        const data=groups.get(entry.name);
        for(const task of jobMetadata.plan){
          if(!data.some(r=>r.balancer===task.balancer && r.workload===task.workload))data.push({...task,status:'N/A',source:path.posix.join(sourcePrefix,entry.name,'metadata.json'),issue:'Bài chưa thực hiện; không có số liệu'});
        }
      }
    }
    for (const [id, data] of groups) {
      rows.push(...data);
      const complete = WORKLOADS.every(w => BALANCERS.every(b => data.some(r => r.workload === w && r.balancer === b && r.status === 'PASS')));
      batches.push({ id, complete, rows: data, origin:sourcePrefix === 'dashboard/results' ? 'dashboard' : 'historical', jobState:jobMetadata?.state,resources,resourceError:resourceError || jobMetadata?.resourceError || null,
        note: jobMetadata?.mode==='full-suite' ? 'FULL RUN PowerShell: 3 LB × 5 workload; CPU/RAM riêng từng bài. Không ghép đợt khác.' : sourcePrefix === 'dashboard/results' ? 'Kết quả đã lưu từ Dashboard; mỗi đợt chỉ chứa loại kiểm thử và LB được chọn. Không ghép với đợt khác.' : id.startsWith('legacy') ? 'Dữ liệu cũ cùng nhóm tên; không có metadata xác nhận cùng điều kiện. Không dùng để kết luận.' : 'Một thư mục đợt chạy; không ghép với đợt khác.' });
    }
  }
  if (root === ROOT) {
    const dashboardRoot = path.join(__dirname,'results');
    try {
      const stat = await fs.lstat(dashboardRoot);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { const extra = await loadResults(dashboardRoot,'dashboard/results'); batches.push(...extra.batches); warnings.push(...extra.warnings); }
    } catch (e) { if (e.code !== 'ENOENT') warnings.push('Không đọc được kết quả Dashboard'); }
  }
  return applyBenchmarkPolicy({ batches, warnings, loadedAt: new Date().toISOString() });
}
function csv(batch, workload) {
  const columns = ['batch', 'workload', 'balancer', 'rps', 'avg_ms', 'p95_ms', 'error_rate_fraction', 'total_requests', 'total_checks', 'status', 'source'];
  const quote = v => '"' + String(v ?? 'N/A').replace(/"/g, '""') + '"';
  const rows = BALANCERS.map(b => {
    const r = batch.rows.find(r => r.balancer === b && r.workload === workload) || {};
    return [batch.id, workload, b, r.rps, r.avg, r.p95, r.errorRate, r.total, r.checks, r.status || 'N/A', r.source];
  });
  return '\uFEFF' + [columns, ...rows].map(r => r.map(quote).join(',')).join('\r\n');
}
module.exports = { loadResults, normalize, csv, BALANCERS, WORKLOADS };
