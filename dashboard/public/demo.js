let demoRows = [], demoTotal = 0, demoCompleted = false;
const demoControls = ['demo-balancer','demo-algorithm','demo-speed','send-10','send-20','send-100','reset-demo','test-all'];
const demoAlgorithms = {
  'round-robin': 'Round Robin',
  'weighted-round-robin': 'Weighted Round Robin',
  'least-connections': 'Least Connections / Least Request',
  'ip-hash': 'IP Hash / Source-IP Affinity',
};
const leastPolicies = {
  nginx: 'Nginx dùng least_conn, chọn backend có ít kết nối upstream đang hoạt động nhất.',
  haproxy: 'HAProxy dùng balance leastconn, xét kết nối đang hoạt động và đang chờ trong hàng đợi.',
  envoy: 'Envoy dùng Least Request (FULL_SCAN), chọn theo số request đang xử lý trên từng backend khỏe. Một kết nối có thể phục vụ nhiều request.',
};
const ipPolicies = {
  nginx: 'Nginx dùng ip_hash với ba octet đầu của IPv4 hoặc toàn bộ địa chỉ IPv6.',
  haproxy: 'HAProxy dùng balance source với consistent hashing trên IP nguồn.',
  envoy: 'Envoy dùng RING_HASH với IP của đầu bên kia kết nối TCP làm khóa.',
};
const selectedAlgorithm = () => $('demo-algorithm').value;
function clearFlow() {
  ['flow-client','flow-lb','flow-backend-1','flow-backend-2','line-client','line-backend-1','line-backend-2'].forEach(id => $(id).classList.remove('active','failed'));
}
function resetDemo() {
  if (running) return;
  demoRows = []; demoTotal = 0; demoCompleted = false;
  setMessage('demo-sent', () => tr('Số yêu cầu đã gửi: 0/0'));
  clearFlow(); renderDemo();
  setMessage('demo-state', () => tr('Sẵn sàng kiểm thử'));
  setMessage('demo-message', () => tr('Đã xóa lịch sử demo; dữ liệu benchmark được giữ nguyên.'));
}
function renderDemo() {
  const weighted = selectedAlgorithm() === 'weighted-round-robin';
  $('wrr-note').hidden = $('wrr-expected').hidden = $('send-100').hidden = !weighted;
  $('wrr-observed-label').hidden = !weighted;
  $('rr-note').hidden = selectedAlgorithm() !== 'round-robin';
  $('least-note').hidden = selectedAlgorithm() !== 'least-connections';
  $('least-policy').textContent = tr(leastPolicies[$('demo-balancer').value]);
  const ipHash = selectedAlgorithm() === 'ip-hash';
  $('ip-note').hidden = $('ip-mapping').hidden = !ipHash;
  if (ipHash) {
    $('ip-policy').textContent = tr(ipPolicies[$('demo-balancer').value]);
    const mappings = new Map();
    for (const row of demoRows) {
      if (row.error || !row.sourceIp || !row.backend) continue;
      if (!mappings.has(row.sourceIp)) mappings.set(row.sourceIp, new Set());
      mappings.get(row.sourceIp).add(names[row.backend]);
    }
    $('ip-mapping').textContent = [...mappings].map(([ip, backends]) => `${ip} → ${[...backends].join(', ')}`).join(' · ')
      || tr('Chưa xác nhận được ánh xạ IP nguồn.');
  }
  const b1 = demoRows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-1').length;
  const b2 = demoRows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-2').length;
  const failed = demoRows.length - b1 - b2;
  const pct = n => demoRows.length ? fmt(n/demoRows.length*100,1) : '0';
  $('count-backend-1').textContent = tr`${b1} yêu cầu · ${pct(b1)}%`;
  $('count-backend-2').textContent = tr`${b2} yêu cầu · ${pct(b2)}%`;
  $('demo-progress').max = demoTotal || 10;
  $('demo-progress').value = demoRows.length;
  $('demo-progress-text').textContent = tr`Số yêu cầu đã xử lý: ${demoRows.length}/${demoTotal}`;
  $('demo-summary').textContent = demoRows.length ? tr`Backend 1: ${b1} (${pct(b1)}%) · Backend 2: ${b2} (${pct(b2)}%) · Thất bại / không xác nhận: ${failed} (${pct(failed)}%) · Tổng: ${demoRows.length}` : tr('Không có dữ liệu. Chọn LB và gửi yêu cầu để bắt đầu.');
  $('demo-distribution').innerHTML = [b1,b2,failed].map((n,i) => `<i style="width:${demoRows.length ? n/demoRows.length*100 : 0}%;background:${['#55d8b3','#77a7fa','#ef8593'][i]}"></i>`).join('');
  $('demo-history').innerHTML = demoRows.map((r,i) => `<tr class="${i === demoRows.length-1 ? 'latest-row' : ''}"><td>${r.number}</td><td>${names[r.balancer]}</td><td>${demoAlgorithms[r.algorithm]}</td><td class="${r.error ? 'error' : 'PASS'}">${esc(names[r.backend] || tr('Không xác định'))}${r.error ? ' · ' + esc(tr('Thất bại: ') + detail(r.error)) : ''}</td><td>${r.status ?? tr('Không có phản hồi')}</td><td>${fmt(r.ms,2)}</td></tr>`).join('');
  $('flow-lb').innerHTML = `${names[$('demo-balancer').value] || 'Load Balancer'}<small>${demoAlgorithms[selectedAlgorithm()] || ''}</small>`;
}
function handleDemoEvent(event) {
  if (event.type === 'start') {
    if (event.algorithm !== selectedAlgorithm() || event.count !== demoTotal || event.balancer !== $('demo-balancer').value) throw new Error('Thông tin luồng không khớp yêu cầu');
    setMessage('demo-state', () => tr('Đang kiểm thử'));
  } else if (event.type === 'request') {
    if (event.number !== demoRows.length + 1) throw new Error('Thứ tự yêu cầu không hợp lệ');
    clearFlow(); $('flow-client').classList.add('active'); $('flow-lb').classList.add('active'); $('line-client').classList.add('active');
    setMessage('demo-sent', () => tr`Số yêu cầu đã gửi: ${event.number}/${demoTotal}`);
    const name = names[$('demo-balancer').value];
    setMessage('demo-message', () => tr`Đang gửi yêu cầu ${event.number}/${demoTotal} tới ${name}…`);
  } else if (event.type === 'result') {
    const r = event.row;
    if (r.number !== demoRows.length + 1 || r.number > demoTotal || r.algorithm !== selectedAlgorithm() || r.balancer !== $('demo-balancer').value) throw new Error('Kết quả không đúng thứ tự hoặc thuật toán');
    demoRows.push(r); clearFlow();
    if (['backend-1','backend-2'].includes(r.backend)) {
      $('flow-'+r.backend).classList.add(r.error ? 'failed' : 'active'); $('line-'+r.backend).classList.add(r.error ? 'failed' : 'active');
    } else { $('flow-lb').classList.add('failed'); }
    renderDemo();
    setMessage('demo-message', () => tr`Yêu cầu ${r.number}: ${r.error ? tr('Thất bại · ')+detail(r.error) : tr('Thành công · ')+names[r.backend]} · HTTP ${r.status ?? 'N/A'} · ${fmt(r.ms,2)} ms`);
    const history = $('demo-history').closest('.request-history');
    if (history) history.scrollTop = history.scrollHeight;
  } else if (event.type === 'done') {
    if (demoRows.length !== demoTotal || event.count !== demoTotal) throw new Error('Luồng kết thúc khi chưa đủ kết quả');
    demoCompleted = true; setMessage('demo-state', () => tr('Hoàn thành kiểm thử'));
  } else if (event.type === 'error') { throw new Error(event.error); }
  else { throw new Error('Sự kiện không được hỗ trợ'); }
}
async function streamDemo(id, count) {
  $('demo-balancer').value = id;
  demoRows = []; demoTotal = count; demoCompleted = false; clearFlow(); renderDemo();
  setMessage('demo-sent', () => tr`Số yêu cầu đã gửi: 0/${count}`);
  setMessage('demo-state', () => tr('Đang kiểm thử'));
  const query = new URLSearchParams({ algorithm: $('demo-algorithm').value, count, speed: $('demo-speed').value });
  const response = await fetch(`/api/demo-stream/${id}?${query}`, { method: 'POST', headers: { 'X-Dashboard-Action':'demo' } });
  if (!response.ok) { const error = await response.json(); throw new Error(error.error); }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,newline); buffer = buffer.slice(newline+1);
        if (line.trim()) handleDemoEvent(JSON.parse(line));
      }
      if (done) break;
    }
    if (buffer.trim() || !demoCompleted) throw new Error('Mất kết nối: chưa nhận đủ kết quả. Lịch sử đã nhận được giữ lại.');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
async function runDemos(selected, count = 10) {
  if (running || !Object.hasOwn(demoAlgorithms, selectedAlgorithm())) return;
  running = true; demoControls.forEach(id => $(id).disabled = true);
  try { for (const id of selected) await streamDemo(id,count); }
  catch (e) {
    setMessage('demo-state', () => tr('Kiểm thử bị gián đoạn'));
    setMessage('demo-message', () => detail(e.message));
  }
  finally { running = false; demoControls.forEach(id => $(id).disabled = false); updateAlgorithm(); }
}
function updateAlgorithm() {
  const supported = Object.hasOwn(demoAlgorithms, selectedAlgorithm());
  ['send-10','send-20','test-all'].forEach(id => $(id).disabled = running || !supported);
  $('send-100').disabled = running || selectedAlgorithm() !== 'weighted-round-robin';
  if (!supported) setMessage('demo-message', () => tr('Chưa triển khai thuật toán này. Không thể chạy.'));
}
$('send-10').onclick = () => runDemos([$('demo-balancer').value],10);
$('send-20').onclick = () => runDemos([$('demo-balancer').value],20);
$('send-100').onclick = () => runDemos([$('demo-balancer').value],100);
$('reset-demo').onclick = resetDemo;
$('demo-balancer').onchange = resetDemo;
$('demo-algorithm').onchange = () => { resetDemo(); updateAlgorithm(); };
onLanguage(renderDemo);
resetDemo();
updateAlgorithm();
