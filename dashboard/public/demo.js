let demoRows = [], demoTotal = 0, demoCompleted = false;
const demoControls = ['demo-balancer','demo-algorithm','demo-speed','send-10','send-20','reset-demo','test-all'];
function clearFlow() {
  ['flow-client','flow-lb','flow-backend-1','flow-backend-2','line-client','line-backend-1','line-backend-2'].forEach(id => $(id).classList.remove('active','failed'));
}
function resetDemo() {
  if (running) return;
  demoRows = []; demoTotal = 0; demoCompleted = false;
  $('demo-sent').textContent = 'Số yêu cầu đã gửi: 0/0';
  clearFlow(); renderDemo();
  $('demo-state').textContent = 'Sẵn sàng kiểm thử';
  $('demo-message').textContent = 'Đã xóa lịch sử demo; dữ liệu benchmark được giữ nguyên.';
}
function renderDemo() {
  const b1 = demoRows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-1').length;
  const b2 = demoRows.filter(r => !r.error && r.status === 200 && r.backend === 'backend-2').length;
  const failed = demoRows.length - b1 - b2;
  const pct = n => demoRows.length ? fmt(n/demoRows.length*100,1) : '0';
  $('count-backend-1').textContent = `${b1} yêu cầu · ${pct(b1)}%`;
  $('count-backend-2').textContent = `${b2} yêu cầu · ${pct(b2)}%`;
  $('demo-progress').max = demoTotal || 10;
  $('demo-progress').value = demoRows.length;
  $('demo-progress-text').textContent = `Số yêu cầu đã xử lý: ${demoRows.length}/${demoTotal}`;
  $('demo-summary').textContent = demoRows.length ? `Backend 1: ${b1} (${pct(b1)}%) · Backend 2: ${b2} (${pct(b2)}%) · Thất bại / không xác nhận: ${failed} (${pct(failed)}%) · Tổng: ${demoRows.length}` : 'Không có dữ liệu. Chọn LB và gửi yêu cầu để bắt đầu.';
  $('demo-distribution').innerHTML = [b1,b2,failed].map((n,i) => `<i style="width:${demoRows.length ? n/demoRows.length*100 : 0}%;background:${['#55d8b3','#77a7fa','#ef8593'][i]}"></i>`).join('');
  $('demo-history').innerHTML = demoRows.map((r,i) => `<tr class="${i === demoRows.length-1 ? 'latest-row' : ''}"><td>${r.number}</td><td>${names[r.balancer]}</td><td>Round Robin</td><td class="${r.error ? 'error' : 'PASS'}">${esc(r.error ? 'Thất bại: ' + r.error : names[r.backend] || 'Không xác định')}${r.error && r.backend ? ' · phản hồi từ ' + esc(names[r.backend]) : ''}</td><td>${r.status ?? 'Không có phản hồi'}</td><td>${fmt(r.ms,2)}</td></tr>`).join('');
  $('flow-lb').innerHTML = `${names[$('demo-balancer').value] || 'Load Balancer'}<small>Round Robin</small>`;
}
function handleDemoEvent(event) {
  if (event.type === 'start') {
    if (event.algorithm !== 'round-robin' || event.count !== demoTotal || event.balancer !== $('demo-balancer').value) throw new Error('Thông tin luồng không khớp yêu cầu');
    $('demo-state').textContent = 'Đang kiểm thử';
  } else if (event.type === 'request') {
    if (event.number !== demoRows.length + 1) throw new Error('Thứ tự yêu cầu không hợp lệ');
    clearFlow(); $('flow-client').classList.add('active'); $('flow-lb').classList.add('active'); $('line-client').classList.add('active');
    $('demo-sent').textContent = `Số yêu cầu đã gửi: ${event.number}/${demoTotal}`;
    $('demo-message').textContent = `Đang gửi yêu cầu ${event.number}/${demoTotal} tới ${names[$('demo-balancer').value]}…`;
  } else if (event.type === 'result') {
    const r = event.row;
    if (r.number !== demoRows.length + 1 || r.number > demoTotal || r.algorithm !== 'round-robin' || r.balancer !== $('demo-balancer').value) throw new Error('Kết quả không đúng thứ tự hoặc thuật toán');
    demoRows.push(r); clearFlow();
    if (['backend-1','backend-2'].includes(r.backend)) {
      $('flow-'+r.backend).classList.add(r.error ? 'failed' : 'active'); $('line-'+r.backend).classList.add(r.error ? 'failed' : 'active');
    } else { $('flow-lb').classList.add('failed'); }
    renderDemo();
    $('demo-message').textContent = `Yêu cầu ${r.number}: ${r.error ? 'Thất bại · '+r.error : 'Thành công · '+names[r.backend]} · HTTP ${r.status ?? 'N/A'} · ${fmt(r.ms,2)} ms`;
    const history = $('demo-history').closest('.request-history');
    if (history) history.scrollTop = history.scrollHeight;
  } else if (event.type === 'done') {
    if (demoRows.length !== demoTotal || event.count !== demoTotal) throw new Error('Luồng kết thúc khi chưa đủ kết quả');
    demoCompleted = true; $('demo-state').textContent = 'Hoàn thành kiểm thử';
  } else if (event.type === 'error') { throw new Error(event.error); }
  else { throw new Error('Sự kiện không được hỗ trợ'); }
}
async function streamDemo(id, count) {
  $('demo-balancer').value = id;
  demoRows = []; demoTotal = count; demoCompleted = false; clearFlow(); renderDemo();
  $('demo-sent').textContent = `Số yêu cầu đã gửi: 0/${count}`;
  $('demo-state').textContent = 'Đang kiểm thử';
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
  if (running || $('demo-algorithm').value !== 'round-robin') return;
  running = true; demoControls.forEach(id => $(id).disabled = true);
  try { for (const id of selected) await streamDemo(id,count); }
  catch (e) { $('demo-state').textContent = 'Kiểm thử bị gián đoạn'; $('demo-message').textContent = e.message; }
  finally { running = false; demoControls.forEach(id => $(id).disabled = false); updateAlgorithm(); }
}
function updateAlgorithm() {
  const supported = $('demo-algorithm').value === 'round-robin';
  ['send-10','send-20','test-all'].forEach(id => $(id).disabled = running || !supported);
  if (!supported) $('demo-message').textContent = 'Chưa triển khai thuật toán này. Không thể chạy.';
}
$('send-10').onclick = () => runDemos([$('demo-balancer').value],10);
$('send-20').onclick = () => runDemos([$('demo-balancer').value],20);
$('reset-demo').onclick = resetDemo;
$('demo-balancer').onchange = resetDemo;
$('demo-algorithm').onchange = updateAlgorithm;
resetDemo();
