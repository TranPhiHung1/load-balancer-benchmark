let benchmarkConfig = null, benchmarkJob = null, benchmarkBusy = false, benchmarkSubmitting = false;
let shownBenchmarkId = null, benchmarkPolling = false;
let benchmarkNotice = '', benchmarkGeneration = 0;
const workloadNames = {rest:'REST API','keepalive-on':'Keep-Alive ON','keepalive-off':'Keep-Alive OFF',http2:'HTTP/2',grpc:'gRPC Unary'};
function renderBenchmark() {
  const job = benchmarkJob;
  if(typeof renderLiveResources==='function')renderLiveResources(job);
  const setting = benchmarkConfig?.workloads.find(w => w.id === $('bench-workload').value);
  $('bench-config').textContent = benchmarkConfig ? `${benchmarkConfig.available ? 'k6 sẵn sàng' : benchmarkConfig.error} · ${setting?.error || (setting ? `${setting.vus} VUs · ${setting.duration}/bài (đọc từ script hiện tại)` : 'Chưa đọc được thông số')}` : 'Chưa đọc được cấu hình';
  const active = benchmarkBusy || benchmarkSubmitting;
  if(typeof updateBatchActions==='function')updateBatchActions();
  $('bench-start').disabled = active || !benchmarkConfig?.available || !setting || !!setting.error;
  $('bench-balancer').disabled = active; $('bench-workload').disabled = active;
  $('bench-stop').disabled = !job || job.state !== 'running' || job.cancelRequested;
  $('bench-view').disabled = !job || job.state === 'running';
  $('bench-state').textContent = {running:'ĐANG CHẠY',success:'THÀNH CÔNG',failed:'THẤT BẠI'}[job?.state] || 'CHƯA CHẠY';
  if (benchmarkSubmitting) $('bench-state').textContent='ĐANG KIỂM TRA ĐIỀU KIỆN';
  $('bench-state').className = 'live ' + (job?.state === 'failed' ? 'FAIL' : '');
  if (!job) { $('bench-message').textContent=benchmarkNotice; return; }
  $('bench-current').textContent = `Benchmark ${job.state === 'running' ? 'đang chạy trực tiếp' : 'đã kết thúc'}: ${job.currentBalancer ? names[job.currentBalancer] : job.balancers.map(b=>names[b]).join(', ')} / ${workloadNames[job.workload]} · ${job.id}`;
  $('bench-started').textContent = 'Bắt đầu: ' + new Date(job.startedAt).toLocaleString('vi-VN');
  const elapsed = Math.max(0,Math.floor(((job.finishedAt ? Date.parse(job.finishedAt) : Date.now())-Date.parse(job.startedAt))/1000));
  $('bench-elapsed').textContent = `Thời gian đã chạy: ${elapsed} giây`;
  $('bench-progress').textContent = `Số bài hoàn thành: ${job.completed}/${job.total}`;
  const log = $('bench-log'), follow = log.scrollHeight-log.scrollTop-log.clientHeight < 60;
  log.textContent = job.logs || 'Đang chuẩn bị tiến trình k6…';
  if (follow) log.scrollTop = log.scrollHeight;
  $('bench-message').textContent = benchmarkNotice || job.error || (job.cancelRequested ? 'Đang dừng tiến trình k6 và lưu kết quả…' : job.state === 'running' ? 'Tiến trình theo bài thực tế; không ước lượng phần trăm.' : 'Đã lưu kết quả. Chỉ số không có bằng chứng sẽ hiển thị N/A.');
}
async function showBenchmarkResults(job = benchmarkJob, scroll = false) {
  if (!job || job.state === 'running') return;
  await refreshResults(job.id,job.workload);
  if (scroll) $('saved-results').scrollIntoView({behavior:'smooth',block:'start'});
}
async function pollBenchmark() {
  if (benchmarkPolling || benchmarkSubmitting) return;
  benchmarkPolling = true;
  const generation=benchmarkGeneration;
  try {
    const data = await api('/api/benchmark/status');
    if(generation !== benchmarkGeneration) return;
    benchmarkJob = data.job; benchmarkBusy = data.busy;
    renderBenchmark();
    if (benchmarkJob && !benchmarkBusy && benchmarkJob.state !== 'running' && shownBenchmarkId !== benchmarkJob.id) {
      await showBenchmarkResults(); shownBenchmarkId = benchmarkJob.id;
    }
  } catch (e) { $('bench-message').textContent = 'Không lấy được trạng thái: '+e.message; }
  finally { benchmarkPolling = false; }
}
async function startBenchmark() {
  if ($('bench-start').disabled || benchmarkSubmitting) return;
  const balancer = $('bench-balancer').value, workload = $('bench-workload').value;
  const setting = benchmarkConfig?.workloads.find(w=>w.id===workload);
  if (!window.confirm(`Chạy k6 thật: ${balancer==='all' ? 'cả ba LB, tuần tự' : names[balancer]} / ${workloadNames[workload]}?\n${setting.vus} VUs, ${setting.duration}/bài. Sẽ tạo tải và lưu thư mục kết quả mới. Không chạy demo khác hoặc benchmark ngoài Dashboard cùng lúc.`)) return;
  benchmarkSubmitting = true; benchmarkNotice=''; benchmarkGeneration++; renderBenchmark();
  try {
    benchmarkJob = await api('/api/benchmark/start',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'benchmark'},body:JSON.stringify({balancer,workload,confirmed:true})});
    benchmarkBusy = true; shownBenchmarkId = null;
  } catch (e) { benchmarkNotice=e.message; }
  finally { benchmarkSubmitting=false; renderBenchmark(); }
}
async function stopBenchmark() {
  if (!window.confirm('Dừng benchmark hiện tại? Giữ log/kết quả đã có, đánh dấu thất bại và không chạy các LB tiếp theo.')) return;
  try { benchmarkJob = await api('/api/benchmark/stop',{method:'POST',headers:{'X-Dashboard-Action':'benchmark'}}); renderBenchmark(); }
  catch(e) { $('bench-message').textContent = e.message; }
}
async function initBenchmark() {
  try { benchmarkConfig = await api('/api/benchmark/config'); renderBenchmark(); await pollBenchmark(); }
  catch(e) { $('bench-message').textContent = e.message; }
}
$('bench-start').onclick=startBenchmark;
$('bench-stop').onclick=stopBenchmark;
$('bench-view').onclick=()=>showBenchmarkResults(benchmarkJob,true);
$('bench-workload').onchange=renderBenchmark;
initBenchmark();
setInterval(pollBenchmark,1000);
