const ids = ['nginx', 'haproxy', 'envoy'];
const names = { nginx: 'Nginx', haproxy: 'HAProxy', envoy: 'Envoy', 'backend-1': 'Backend 1', 'backend-2': 'Backend 2' };
const colors = { nginx: '#4bdbac', haproxy: '#6daaff', envoy: '#c397ff' };
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = (v, digits = 3) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'N/A';
let results = { batches: [] }, running = false;
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
$('status').innerHTML = Object.entries(names).map(([id, name], i) => `<div class="status-card" id="status-${id}"><strong>${name}</strong><span class="endpoint">127.0.0.1:${[8080,8081,8082,3001,3002][i]}</span><span class="state Unknown">● Chưa xác định</span></div>`).join('');
async function refreshStatus() {
  $('refresh-status').disabled = true;
  try {
    const data = await api('/api/status');
    for (const c of data.components) {
      const el = $(`status-${c.id}`).querySelector('.state');
      el.className = 'state ' + c.state;
      el.textContent = `● ${{Online:'Đang hoạt động',Offline:'Không hoạt động',Unknown:'Chưa xác định'}[c.state]}${c.status ? ' · HTTP ' + c.status : ''}`;
      el.title = c.error || `Backend: ${c.backend}; ${c.ms} ms`;
    }
    $('status-time').textContent = `Kiểm tra HTTP /api: ${new Date(data.checkedAt).toLocaleString('vi-VN')} · Đang hoạt động = HTTP 200 và nhận diện backend hợp lệ. Di chuột xem chi tiết.`;
  } catch (e) {
    document.querySelectorAll('.state').forEach(el => { el.className = 'state Unknown'; el.textContent = '● Chưa xác định'; });
    $('status-time').textContent = e.message;
  } finally { $('refresh-status').disabled = false; }
}
function render() {
  const batch = results.batches.find(b => b.id === $('batch').value), workload = $('workload').value;
  const rows = ids.map(b => batch?.rows.find(r => r.balancer === b && r.workload === workload) || { balancer: b });
  $('export').disabled = !batch;
  $('batch-note').textContent = batch ? `${batch.pinned ? '📌 '+batch.officialLabel+' · ' : ''}${batch.id} · ${batch.origin === 'dashboard' ? 'Đợt chạy từ Dashboard (' + ({running:'đang chạy',success:'thành công',failed:'thất bại'}[batch.jobState] || 'đã lưu') + ')' : batch.complete ? 'Đủ 15 kết quả PASS' : 'Đợt thiếu dữ liệu hoặc chưa xác minh đầy đủ'} · ${batch.note}` : 'Không có kết quả benchmark qua Load Balancer.';
  $('benchmark-table').innerHTML = rows.map(r => `<tr><td style="color:${colors[r.balancer]}"><strong>${names[r.balancer]}</strong></td><td>${fmt(r.rps)}</td><td>${fmt(r.avg)}</td><td>${fmt(r.p95)}</td><td>${fmt(typeof r.errorRate === 'number' ? r.errorRate*100 : null)}</td><td>${fmt(r.total,0)}</td><td>${fmt(r.checks,0)}</td><td class="${r.status || ''}">${{PASS:'Thành công',FAIL:'Thất bại'}[r.status] || 'N/A'}</td></tr>`).join('');
  const chartMetrics = [['rps','Throughput','RPS',1],['avg','Độ trễ trung bình','ms',1],['p95','Độ trễ P95','ms',1],['errorRate','Tỷ lệ lỗi','%',100]];
  $('charts').innerHTML = chartMetrics.map(([key,title,unit,mult]) => {
    const max = Math.max(0, ...rows.map(r => typeof r[key] === 'number' ? r[key]*mult : 0));
    return `<article class="chart"><h3>${title} <span class="muted">(${unit})</span></h3>${rows.map(r => {
      const value = typeof r[key] === 'number' ? r[key]*mult : null;
      return `<div class="bar-row" style="--color:${colors[r.balancer]}"><div class="bar-label"><span>${names[r.balancer]}</span><strong>${fmt(value)} ${unit}</strong></div><div class="bar-track" role="img" aria-label="${names[r.balancer]}: ${fmt(value)} ${unit}"><div class="bar" style="width:${value !== null && max > 0 ? value/max*100 : 0}%"></div></div></div>`;
    }).join('')}</article>`;
  }).join('');
  $('sources').innerHTML = rows.map(r => `<p>${names[r.balancer]}: ${esc(r.source || 'N/A')}${r.exitCode !== null && r.exitCode !== undefined ? ' · exitCode=' + r.exitCode : ''}</p>`).join('');
  if(typeof updateBatchActions==='function')updateBatchActions();
  if(typeof renderSavedResources==='function')renderSavedResources();
}
async function refreshResults(selectedBatch, selectedWorkload) {
  $('refresh-results').disabled = true;
  try {
    const selected = typeof selectedBatch === 'string' ? selectedBatch : $('batch').value;
    results = await api('/api/results');
    $('batch').innerHTML = results.batches.map(b => `<option value="${esc(b.id)}">${b.pinned ? '📌 '+esc(b.officialLabel)+' — ' : ''}${esc(b.id)}${!b.pinned && b.complete ? ' ✓' : ''}</option>`).join('');
    $('batch').value = results.batches.some(b => b.id === selected) ? selected : results.defaultBatchId || results.batches.find(b=>b.pinned)?.id || results.batches[0]?.id || '';
    if (['rest','keepalive-on','keepalive-off','http2','grpc'].includes(selectedWorkload)) $('workload').value = selectedWorkload;
    $('warnings').textContent = results.warnings.join(' · ');
    render();
    return true;
  } catch (e) { $('warnings').textContent = e.message; return false; }
  finally { $('refresh-results').disabled = false; }
}
$('refresh-status').onclick = refreshStatus;
$('refresh-results').onclick = refreshResults;
$('test-all').onclick = () => runDemos(ids);

$('batch').onchange = render;
$('workload').onchange = render;
$('export').onclick = () => {
  const batch = results.batches.find(b => b.id === $('batch').value), workload = $('workload').value;
  if (!batch) return;
  const columns = ['batch','workload','balancer','rps','avg_ms','p95_ms','error_rate_fraction','total_requests','total_checks','status','source'];
  const rows = ids.map(b => {
    const r = batch.rows.find(r => r.balancer === b && r.workload === workload) || {};
    return [batch.id,workload,b,r.rps,r.avg,r.p95,r.errorRate,r.total,r.checks,r.status || 'N/A',r.source];
  });
  const quote = value => '"' + String(value ?? 'N/A').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + [columns,...rows].map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `benchmark-${batch.id}-${workload}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
refreshResults();
refreshStatus();
