const ids = ['nginx', 'haproxy', 'envoy'];
const names = { nginx: 'Nginx', haproxy: 'HAProxy', envoy: 'Envoy', 'backend-1': 'Backend 1', 'backend-2': 'Backend 2' };
const colors = { nginx: 'var(--series-nginx)', haproxy: 'var(--series-haproxy)', envoy: 'var(--series-envoy)' };
const workloadNames = {rest:'REST API','keepalive-on':'Keep-Alive ON','keepalive-off':'Keep-Alive OFF',http2:'HTTP/2',grpc:'gRPC Unary'};
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = (v, digits = 3) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: digits }) : 'N/A';
let results = { batches: [] }, running = false;
const tr = (source, ...values) => globalThis.lbI18n?.translate(source, ...values) ??
  (typeof source === 'string' ? source : source.reduce((text, part, i) => text + (i ? values[i - 1] : '') + part, ''));
const detail = text => globalThis.lbI18n?.detail(text) ?? text;
const dateLocale = () => globalThis.lbI18n?.locale() || 'vi-VN';
const onLanguage = render => globalThis.lbI18n?.subscribe(render);
const messages = new Map();
function setMessage(id, render) {
  messages.set(id, render);
  $(id).textContent = render();
}
onLanguage(() => {
  for (const [id, render] of messages) $(id).textContent = render();
});
async function api(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
let statusData, statusError;
function renderStatus() {
  $('status').innerHTML = Object.entries(names).map(([id, name], i) => {
    const component = statusData?.components.find(item => item.id === id);
    const state = ['Online', 'Offline'].includes(component?.state) ? component.state : 'Unknown';
    const label = { Online: 'Đang hoạt động', Offline: 'Không hoạt động', Unknown: 'Chưa xác định' }[state];
    const tooltip = component?.error ? detail(component.error) : component ? `Backend: ${component.backend} · ${component.ms} ms` : '';
    return `<div class="status-card" id="status-${id}"><strong>${name}</strong><span class="endpoint">127.0.0.1:${[8080,8081,8082,3001,3002][i]}</span><span class="state ${state}" title="${esc(tooltip)}">● ${tr(label)}${component?.status ? ' · HTTP ' + esc(component.status) : ''}</span></div>`;
  }).join('');
  $('status-time').textContent = statusData
    ? tr`Kiểm tra HTTP /api: ${new Date(statusData.checkedAt).toLocaleString(dateLocale())} · Đang hoạt động = HTTP 200 và nhận diện backend hợp lệ. Di chuột xem chi tiết.`
    : statusError ? tr`Không kiểm tra được trạng thái: ${detail(statusError)}`
      : tr('Chưa kiểm tra. Trạng thái hoạt động dựa trên HTTP /api, không phải trạng thái container.');
}
renderStatus();
onLanguage(renderStatus);
async function refreshStatus() {
  if ($('refresh-status').disabled) return;
  $('refresh-status').disabled = true;
  try {
    statusData = await api('/api/status');
    statusError = null;
  } catch (e) {
    statusData = null;
    statusError = e.message;
  } finally {
    renderStatus();
    $('refresh-status').disabled = false;
  }
}
function mountStatus() {
  const route = window.location.hash.split('?')[0];
  if (route !== '#/demo' && route !== '#/benchmark') return;
  const page = $(route === '#/demo' ? 'page-demo' : 'page-benchmark');
  page.querySelector('.page-heading').after($('system-overview'));
  refreshStatus();
}
if (globalThis.lbPreferences) {
  window.addEventListener('hashchange', mountStatus);
  mountStatus();
}
function pinnedLabel(batch) {
  const measured = batch.resources?.measurements.filter(item => item.summary?.validSamples > 0) || [];
  const covered = new Set(measured.map(item => `${item.balancer}/${item.workload}`));
  if (batch.complete && batch.rows.every(row => covered.has(`${row.balancer}/${row.workload}`))) return tr(batch.officialLabel);
  return [tr('RUN chính thức'), batch.complete && '15/15 PASS', covered.size && tr('Có dữ liệu CPU/RAM')].filter(Boolean).join(' · ');
}
function render() {
  const batch = results.batches.find(b => b.id === $('batch').value), workload = $('workload').value;
  const rows = ids.map(b => batch?.rows.find(r => r.balancer === b && r.workload === workload) || { balancer: b });
  $('export').disabled = !batch;
  $('batch-note').textContent = batch ? `${batch.pinned ? '📌 '+pinnedLabel(batch)+' · ' : ''}${batch.id} · ${batch.origin === 'dashboard' ? tr('Đợt chạy từ Dashboard') + ' (' + tr({running:'đang chạy',success:'thành công',failed:'thất bại'}[batch.jobState] || 'đã lưu') + ')' : batch.complete ? tr('Đủ 15 kết quả PASS') : tr('Đợt thiếu dữ liệu hoặc chưa xác minh đầy đủ')} · ${detail(batch.note)}` : tr('Không có kết quả benchmark qua Load Balancer.');
  $('benchmark-table').innerHTML = rows.map(r => `<tr><td style="color:${colors[r.balancer]}"><strong>${names[r.balancer]}</strong></td><td>${fmt(r.rps)}</td><td>${fmt(r.avg)}</td><td>${fmt(r.p95)}</td><td>${fmt(typeof r.errorRate === 'number' ? r.errorRate*100 : null)}</td><td>${fmt(r.total,0)}</td><td>${fmt(r.checks,0)}</td><td class="${r.status || ''}">${tr({PASS:'Thành công',FAIL:'Thất bại'}[r.status] || 'N/A')}</td></tr>`).join('');
  const chartMetrics = [['rps','Throughput','RPS',1],['avg','Độ trễ trung bình','ms',1],['p95','Độ trễ P95','ms',1],['errorRate','Tỷ lệ lỗi','%',100]];
  $('charts').innerHTML = chartMetrics.map(([key,title,unit,mult]) => {
    const max = Math.max(0, ...rows.map(r => typeof r[key] === 'number' ? r[key]*mult : 0));
    return `<article class="chart"><h3>${tr(title)} <span class="muted">(${unit})</span></h3>${rows.map(r => {
      const value = typeof r[key] === 'number' ? r[key]*mult : null;
      return `<div class="bar-row" style="--color:${colors[r.balancer]}"><div class="bar-label"><span>${names[r.balancer]}</span><strong>${fmt(value)} ${unit}</strong></div><div class="bar-track" role="img" aria-label="${names[r.balancer]}: ${fmt(value)} ${unit}"><div class="bar" style="width:${value !== null && max > 0 ? value/max*100 : 0}%"></div></div></div>`;
    }).join('')}</article>`;
  }).join('');
  $('sources').innerHTML = rows.map(r => `<p>${names[r.balancer]}: ${esc(r.source || 'N/A')}${r.exitCode !== null && r.exitCode !== undefined ? ' · exitCode=' + r.exitCode : ''}</p>`).join('');
  if(typeof updateBatchActions==='function')updateBatchActions();
  if(typeof renderSavedResources==='function')renderSavedResources();
}
function renderBatchOptions(selected) {
  $('batch').innerHTML = results.batches.map(b => `<option value="${esc(b.id)}">${b.pinned ? '📌 '+esc(pinnedLabel(b))+' — ' : ''}${esc(b.id)}${!b.pinned && b.complete ? ' ✓' : ''}</option>`).join('');
  $('batch').value = selected;
}
onLanguage(() => {
  renderBatchOptions($('batch').value);
  render();
});
async function refreshResults(selectedBatch, selectedWorkload) {
  $('refresh-results').disabled = true;
  try {
    const selected = typeof selectedBatch === 'string' ? selectedBatch : $('batch').value;
    results = await api('/api/results');
    renderBatchOptions(results.batches.some(b => b.id === selected) ? selected : results.defaultBatchId || results.batches.find(b=>b.pinned)?.id || results.batches[0]?.id || '');
    if (['rest','keepalive-on','keepalive-off','http2','grpc'].includes(selectedWorkload)) $('workload').value = selectedWorkload;
    const warnings = [...results.warnings];
    if (!results.batches.some(b => b.pinned)) warnings.unshift('Máy này chưa có dữ liệu RUN chính thức của đồ án.');
    setMessage('warnings', () => warnings.map(detail).join(' · '));
    render();
    return true;
  } catch (e) { setMessage('warnings', () => detail(e.message)); return false; }
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
