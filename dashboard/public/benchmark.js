let benchmarkConfig = null, benchmarkJob = null, benchmarkBusy = false, benchmarkSubmitting = false;
let shownBenchmarkId = null, benchmarkPolling = false;
let benchmarkNotice = '', benchmarkGeneration = 0;
let benchmarkStatusError = '';
let failoverBlock = '';
function renderBenchmarkNotice(job) {
  $('bench-message').textContent = benchmarkStatusError
    ? tr('Không lấy được trạng thái: ') + detail(benchmarkStatusError)
    : detail(failoverBlock || benchmarkNotice || job?.error) || (job ? tr(job.cancelRequested
      ? 'Đang dừng tiến trình k6 và lưu kết quả…' : job.state === 'running'
        ? 'Tiến trình theo bài thực tế; không ước lượng phần trăm.'
        : 'Đã lưu kết quả. Chỉ số không có bằng chứng sẽ hiển thị N/A.') : '');
}
function renderBenchmark() {
  const job = benchmarkJob;
  if(typeof renderLiveResources==='function')renderLiveResources(job);
  const setting = benchmarkConfig?.workloads.find(w => w.id === $('bench-workload').value);
  $('bench-config').textContent = benchmarkConfig ? `${benchmarkConfig.available ? tr('k6 sẵn sàng') : detail(benchmarkConfig.error)} · ${setting?.error ? detail(setting.error) : setting ? tr`${setting.vus} VUs · ${setting.duration}/bài (đọc từ script hiện tại)` : tr('Chưa đọc được thông số')}` : tr('Chưa đọc được cấu hình');
  const active = benchmarkBusy || benchmarkSubmitting;
  if(typeof updateBatchActions==='function')updateBatchActions();
  $('bench-start').disabled = active || !!failoverBlock || !benchmarkConfig?.available || !setting || !!setting.error;
  $('bench-balancer').disabled = active; $('bench-workload').disabled = active;
  $('bench-stop').disabled = !job || job.state !== 'running' || job.cancelRequested;
  $('bench-view').disabled = !job || job.state === 'running';
  $('bench-state').textContent = tr({running:'ĐANG CHẠY',success:'THÀNH CÔNG',failed:'THẤT BẠI'}[job?.state] || 'CHƯA CHẠY');
  if (benchmarkSubmitting) $('bench-state').textContent=tr('ĐANG KIỂM TRA ĐIỀU KIỆN');
  $('bench-state').className = 'live ' + (job?.state === 'failed' ? 'FAIL' : '');
  renderBenchmarkNotice(job);
  if (!job) return;
  $('bench-current').textContent = tr`Benchmark ${tr(job.state === 'running' ? 'đang chạy trực tiếp' : 'đã kết thúc')}: ${job.currentBalancer ? names[job.currentBalancer] : job.balancers.map(b=>names[b]).join(', ')} / ${workloadNames[job.workload]} · ${job.id}`;
  $('bench-started').textContent = tr('Bắt đầu: ') + new Date(job.startedAt).toLocaleString(dateLocale());
  const elapsed = Math.max(0,Math.floor(((job.finishedAt ? Date.parse(job.finishedAt) : Date.now())-Date.parse(job.startedAt))/1000));
  $('bench-elapsed').textContent = tr`Thời gian đã chạy: ${elapsed} giây`;
  $('bench-progress').textContent = tr`Số bài hoàn thành: ${job.completed}/${job.total}`;
  const log = $('bench-log'), follow = log.scrollHeight-log.scrollTop-log.clientHeight < 60;
  log.textContent = job.logs || tr('Đang chuẩn bị tiến trình k6…');
  if (follow) log.scrollTop = log.scrollHeight;
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
    failoverBlock = data.failoverBlock || '';
    benchmarkStatusError = '';
    renderBenchmark();
    if (benchmarkJob && !benchmarkBusy && benchmarkJob.state !== 'running' && shownBenchmarkId !== benchmarkJob.id) {
      await showBenchmarkResults(); shownBenchmarkId = benchmarkJob.id;
    }
  } catch (e) {
    benchmarkStatusError = e.message;
    renderBenchmarkNotice(benchmarkJob);
  }
  finally { benchmarkPolling = false; }
}
async function startBenchmark() {
  if ($('bench-start').disabled || benchmarkSubmitting) return;
  const balancer = $('bench-balancer').value, workload = $('bench-workload').value;
  const setting = benchmarkConfig?.workloads.find(w=>w.id===workload);
  if (!window.confirm(tr`Chạy k6 thật: ${balancer==='all' ? tr('cả ba LB, tuần tự') : names[balancer]} / ${workloadNames[workload]}?\n${setting.vus} VUs, ${setting.duration}/bài. Sẽ tạo tải và lưu thư mục kết quả mới. Không chạy demo khác hoặc benchmark ngoài Dashboard cùng lúc.`)) return;
  benchmarkSubmitting = true; benchmarkNotice=''; benchmarkGeneration++; renderBenchmark();
  try {
    benchmarkJob = await api('/api/benchmark/start',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'benchmark'},body:JSON.stringify({balancer,workload,confirmed:true})});
    benchmarkBusy = true; shownBenchmarkId = null;
  } catch (e) { benchmarkNotice=e.message; }
  finally { benchmarkSubmitting=false; renderBenchmark(); }
}
async function stopBenchmark() {
  if (!window.confirm(tr('Dừng benchmark hiện tại? Giữ log/kết quả đã có, đánh dấu thất bại và không chạy các LB tiếp theo.'))) return;
  try {
    benchmarkJob = await api('/api/benchmark/stop',{method:'POST',headers:{'X-Dashboard-Action':'benchmark'}});
    benchmarkNotice = '';
  } catch (e) { benchmarkNotice = e.message; }
  renderBenchmark();
}
async function initBenchmark() {
  try { benchmarkConfig = await api('/api/benchmark/config'); renderBenchmark(); await pollBenchmark(); }
  catch (e) { benchmarkNotice = e.message; renderBenchmark(); }
}
$('bench-start').onclick=startBenchmark;
$('bench-stop').onclick=stopBenchmark;
$('bench-view').onclick=()=>showBenchmarkResults(benchmarkJob,true);
$('bench-workload').onchange=renderBenchmark;
onLanguage(renderBenchmark);
initBenchmark();
setInterval(pollBenchmark,1000);
