const renderBenchmarkComparison = (() => {
  const metrics = [
    ['rps', 'Throughput', 'RPS', 1, true],
    ['avg', 'Độ trễ trung bình', 'ms', 1, false],
    ['p95', 'Độ trễ P95', 'ms', 1, false],
    ['errorRate', 'Tỷ lệ lỗi', 'pp', 100, false]
  ];
  const numeric = value => Number.isFinite(value) && value >= 0;
  const valid = (row, key) => row.status === 'PASS' && numeric(row[key]);

  function compare(rows, [key, , , scale, higher]) {
    const eligible = rows.filter(row => valid(row, key));
    eligible.sort((a, b) => higher ? b[key] - a[key] : a[key] - b[key]);
    const ranking = eligible.map(row => ({
      row, rank: eligible.findIndex(other => other[key] === row[key]) + 1
    }));
    const leaders = ranking.filter(item => item.rank === 1).map(item => item.row);
    const pairs = rows.flatMap((left, i) => rows.slice(i + 1).map(right => {
      if (!valid(left, key) || !valid(right, key)) return { left, right };
      const delta = left[key] - right[key];
      return { left, right, delta: delta * scale, percent: right[key] > 0 ? delta / right[key] * 100 : null };
    }));
    return { leaders, ranking, pairs };
  }

  function comparableResources(batch, workload, rows) {
    if (!Array.isArray(batch?.resources?.measurements) || batch.resources.jobId !== batch.id ||
        rows.length !== 3 || rows.some(row => row.status !== 'PASS' || row.workload !== workload)) return [];
    const measurements = rows.map(row => {
      const candidates = batch.resources.measurements.filter(m => m.balancer === row.balancer && m.workload === workload);
      return candidates.length === 1 ? candidates[0] : null;
    });
    if (measurements.some((m, i) => {
      const row = rows[i];
      if (!m || m.container !== row.balancer + '-lb' || m.source !== 'Docker Engine API' || m.state !== 'complete' ||
          m.cpuUnit !== '%' || m.memoryUnit !== 'MiB' || !m.cpuDefinition || !m.memoryDefinition ||
          !numeric(m.intervalMs) || m.intervalMs === 0 || !row.duration || !Number.isInteger(row.vus) || row.vus <= 0) return true;
      const start = Date.parse(m.startedAt), end = Date.parse(m.finishedAt);
      const runStart = Date.parse(row.startedAt), runEnd = Date.parse(row.finishedAt);
      if (![start, end, runStart, runEnd].every(Number.isFinite) || start < runStart || end > runEnd || end <= start) return true;
      const { summary, samples } = m;
      const nominalMs = /^([1-9]\d*)s$/.exec(row.duration)?.[1] * 1000;
      const span = end - start;
      return !Number.isFinite(nominalMs) || Math.abs(span - nominalMs) > m.intervalMs * 2 ||
        !summary || !Array.isArray(samples) || summary.validSamples < Math.max(2, Math.floor(span / m.intervalMs) - 2) ||
        !['cpuAverage', 'cpuMax', 'memoryAverageMiB', 'memoryMaxMiB'].every(key => numeric(summary[key]));
    })) return [];
    const first = measurements[0];
    const elapsed = m => Date.parse(m.finishedAt) - Date.parse(m.startedAt);
    const bases = new Set(measurements.flatMap(m => m.samples.filter(sample => numeric(sample.memoryMiB)).map(sample => sample.memoryBasis)));
    if (bases.size !== 1 || !['raw-usage', 'usage-minus-inactive-file'].includes([...bases][0])) return [];
    if (measurements.some((m, i) => m.cpuDefinition !== first.cpuDefinition || m.memoryDefinition !== first.memoryDefinition ||
        m.intervalMs !== first.intervalMs || rows[i].duration !== rows[0].duration || rows[i].vus !== rows[0].vus ||
        Math.abs(elapsed(m) - elapsed(first)) > first.intervalMs * 2 ||
        Math.abs(m.summary.cpuSamples - first.summary.cpuSamples) > 2 ||
        Math.abs(m.summary.memorySamples - first.summary.memorySamples) > 2)) return [];
    return measurements;
  }

  function render(batch, workload, rows) {
    const lang = (vi, en) => dateLocale() === 'en-US' ? en : vi;
    const number = (value, digits = 3) => value.toLocaleString(dateLocale(), { maximumFractionDigits: digits });
    const absoluteUnit = unit => unit === 'pp' ? lang('điểm %', 'pp') : unit;
    const cards = metrics.map(metric => {
      const [key, title, unit, scale, higher] = metric;
      const { leaders, ranking, pairs } = compare(rows, metric);
      const leaderNames = leaders.map(row => names[row.balancer]).join(' · ');
      const label = leaders.length ? (leaders.length > 1 ? lang('Đồng hạng', 'Joint leaders') :
        higher ? lang('Cao nhất', 'Highest') : lang('Thấp nhất', 'Lowest')) : lang('Chưa đủ dữ liệu', 'No eligible data');
      const notes = pairs.map(({ left, right, delta, percent }) => {
        const a = names[left.balancer], b = names[right.balancer];
        if (delta === undefined) {
          const missing = [left, right].filter(row => !valid(row, key)).map(row => names[row.balancer]).join(', ');
          return `${a} / ${b} · ${lang('Thiếu số đo PASS của', 'Missing a valid PASS value for')} ${missing}`;
        }
        const relative = percent === null ? lang('N/A (mốc bằng 0)', 'N/A (zero baseline)') : `${percent > 0 ? '+' : ''}${number(percent)}%`;
        if (delta === 0) return `${a} = ${b} · 0 ${absoluteUnit(unit)} · ${relative}`;
        const value = `${number(Math.abs(delta))} ${absoluteUnit(unit)}`;
        return lang(
          `Trong RUN đang chọn, ${a} ${delta > 0 ? 'cao hơn' : 'thấp hơn'} ${b} ${value}, tương đương ${relative}.`,
          `In the selected run, ${a} is ${value} ${delta > 0 ? 'above' : 'below'} ${b} (${relative}).`
        );
      });
      const ranked = ranking.map(({ row, rank }) => `<tr><td>${rank}</td><th scope="row">${names[row.balancer]}</th><td>${number(row[key] * scale)} ${unit === 'pp' ? '%' : unit}</td></tr>`);
      ranked.push(...rows.filter(row => !valid(row, key)).map(row =>
        `<tr><td>—</td><th scope="row">${names[row.balancer]}</th><td>N/A</td></tr>`));
      return `<article class="chart"><h3>${tr(title)}</h3><p><strong>${label}</strong>${leaderNames ? ' · ' + leaderNames : ''}</p>
        <table class="ranking-table"><thead><tr><th scope="col">${lang('Hạng', 'Rank')}</th><th scope="col">Proxy</th><th scope="col">${lang('Giá trị', 'Value')}</th></tr></thead><tbody>${ranked.join('')}</tbody></table>
        <ul>${notes.map(note => `<li>${note}</li>`).join('')}</ul></article>`;
    }).join('');
    const measurements = comparableResources(batch, workload, rows);
    const resourceTitle = lang('CPU và RAM của container proxy', 'Proxy container CPU and RAM');
    const taskMeasurements = batch?.resources?.measurements?.filter(m => m.workload === workload) ?? [];
    const reason = batch?.resourceError ? esc(detail(batch.resourceError)) :
      !batch ? lang('Chưa có RUN được chọn.', 'No run is selected.') :
      !taskMeasurements.length ? lang('RUN này chưa lưu mẫu CPU/RAM cho workload đang chọn.', 'This run has no saved CPU/RAM samples for the selected workload.') :
      taskMeasurements.length < 3 ? lang('Workload này thiếu phép đo của một hoặc nhiều proxy.', 'This workload is missing measurements for one or more proxies.') :
      rows.some(row => !row.startedAt || !row.finishedAt) ? lang('Thiếu mốc thời gian của một hoặc nhiều lượt k6 để xác nhận khoảng đo.', 'One or more k6 task timestamps are missing, so measurement windows cannot be verified.') :
      lang('Các phép đo chưa đồng nhất về phạm vi, thời gian, độ phủ mẫu hoặc cách tính RAM.', 'Measurement scope, timing, sample coverage or RAM accounting is incompatible.');
    let resources = `<p class="comparison-resource-note">${reason}</p>`;
    if (measurements.length) {
      const basis = measurements[0].samples.find(sample => numeric(sample.memoryMiB)).memoryBasis;
      const ramMethod = basis === 'raw-usage' ? lang('RAM dùng mức sử dụng thô.', 'RAM uses raw usage.') :
        lang('RAM đã trừ bộ nhớ đệm tệp không hoạt động.', 'RAM excludes inactive file cache.');
      const efficiency = rows.every((row, i) => numeric(row.rps) && measurements[i].summary.cpuAverage > 0 && measurements[i].summary.memoryAverageMiB > 0);
      const headers = ['Proxy', lang('CPU TB (%)', 'Avg CPU (%)'), lang('CPU đỉnh (%)', 'Peak CPU (%)'),
        lang('RAM TB (MiB)', 'Avg RAM (MiB)'), lang('RAM đỉnh (MiB)', 'Peak RAM (MiB)')];
      if (efficiency) headers.push('RPS / 1% CPU', 'RPS / MiB');
      resources = `<div class="table-scroll"><table><thead><tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${measurements.map((m, i) => {
        const s = m.summary;
        const values = [s.cpuAverage, s.cpuMax, s.memoryAverageMiB, s.memoryMaxMiB];
        if (efficiency) values.push(rows[i].rps / s.cpuAverage, rows[i].rps / s.memoryAverageMiB);
        return `<tr><th scope="row">${names[m.balancer]}</th>${values.map(value => `<td>${number(value)}</td>`).join('')}</tr>`;
      }).join('')}</tbody></table></div><p class="muted">${lang('Nguồn Docker Engine API. Mỗi proxy được đo trong lượt k6 riêng, cùng cấu hình tải và nhịp lấy mẫu. CPU của container dùng thang 100% mỗi lõi. TB là trung bình cộng, đỉnh là mẫu lớn nhất.', 'Source Docker Engine API. Each proxy is sampled during its own k6 task with matching load settings and cadence. Container CPU uses 100% per core. Averages are arithmetic means and peaks are sampled maxima.')} ${ramMethod}</p>` +
        (efficiency ? `<p class="muted">${lang('Hiệu quả quan sát = throughput chia cho CPU TB (%) hoặc RAM TB (MiB) của container proxy. Phạm vi đo chỉ gồm proxy.', 'Observed efficiency = throughput divided by mean proxy container CPU (%) or mean RAM (MiB). Measurements cover the proxy only.')}</p>` : '');
    }
    const panel = $('comparison-content');
    if (!panel) return;
    panel.innerHTML = `
      <p class="muted">${lang('Xếp hạng các giá trị PASS hiện có trong RUN và workload đang chọn. Chênh lệch tương đối = (A − B) / B × 100%, lấy proxy thứ hai làm mốc. Tỷ lệ lỗi chênh lệch theo điểm phần trăm.', 'Ranks available PASS values in the selected run and workload. Relative change = (A − B) / B × 100%, using the second proxy as baseline. Error-rate gaps use percentage points.')}</p>
      <div class="comparison-grid">${cards}</div><h4>${resourceTitle}</h4>${resources}`;
  }

  if (typeof module !== 'undefined') module.exports = { compare, comparableResources };
  return render;
})();

let resourceJobId=null;
const resourceStates={waiting:'Đang chờ',collecting:'Đang thu thập',complete:'Hoàn tất','no-data':'Không có dữ liệu',error:'Lỗi thu thập'};
function resourceChart(measurement,key,title,unit){
  const samples=Array.isArray(measurement?.samples) ? measurement.samples : [];
  const valid=samples.filter(s=>typeof s[key]==='number' && Number.isFinite(s[key]));
  if(!valid.length)return `<article class="resource-chart"><h4>${tr(title)} (${unit})</h4><p class="muted">${tr('Không có dữ liệu · N/A')}</p></article>`;
  const observedMax=Math.max(...valid.map(s=>s[key])),max=Math.max(1,observedMax);
  const start=Date.parse(measurement.startedAt),end=Date.parse(measurement.finishedAt) || Date.now(),span=Math.max(1000,end-start);
  let previous=null;const segments=[],dots=[];
  for(const sample of samples){
    if(typeof sample[key]!=='number' || !Number.isFinite(sample[key])){previous=null;continue;}
    const x=40+Math.max(0,Math.min(1,(Date.parse(sample.timestamp)-start)/span))*490,y=145-sample[key]/max*115;
    if(!Number.isFinite(x)||!Number.isFinite(y)){previous=null;continue;}
    if(previous)segments.push(`<line x1="${previous.x}" y1="${previous.y}" x2="${x}" y2="${y}" class="resource-line"/>`);
    dots.push(`<circle cx="${x}" cy="${y}" r="2.8"><title>${esc(new Date(sample.timestamp).toLocaleTimeString(dateLocale()))}: ${fmt(sample[key],2)} ${unit}</title></circle>`);previous={x,y};
  }
  return `<article class="resource-chart"><h4>${tr(title)} (${unit})</h4><svg viewBox="0 0 560 180" role="img" aria-label="${tr`${tr(title)}: ${valid.length} mẫu, cao nhất ${fmt(observedMax,2)} ${unit}`}"><line x1="40" y1="145" x2="530" y2="145" class="resource-axis"/><line x1="40" y1="25" x2="40" y2="145" class="resource-axis"/><text x="2" y="32">${fmt(max,1)}</text><text x="20" y="149">0</text>${segments.join('')}${dots.join('')}<text x="40" y="169">${tr('0 giây')}</text><text x="470" y="169"> ${tr`${fmt(span/1000,1)} giây`}</text></svg></article>`;
}
function resourcePanel(data){
  const summary=data.summary || {},samples=Array.isArray(data.samples)?data.samples:[],last=samples.at(-1);
  const elapsed=data.startedAt ? Math.max(0,((Date.parse(data.finishedAt)||Date.now())-Date.parse(data.startedAt))/1000):0;
  const errors=Array.isArray(data.errors) ? data.errors : [];
  return `<div class="resource-heading"><strong>${esc(names[data.balancer] || data.balancer)} · ${esc(data.container)} · ${esc(workloadNames[data.workload] || data.workload)}</strong><span>${tr(resourceStates[data.state] || 'Không có dữ liệu')} · ${tr`${fmt(elapsed,1)} giây`}</span></div>
    <div class="resource-cards"><div>CPU ${tr(data.state==='collecting'?'hiện tại':'mẫu cuối')}<strong>${fmt(last?.cpuPercent,2)} %</strong></div><div>RAM ${tr(data.state==='collecting'?'hiện tại':'mẫu cuối')}<strong>${fmt(last?.memoryMiB,2)} MiB</strong></div><div>${tr('Mẫu hợp lệ CPU + RAM')}<strong>${fmt(summary.validSamples,0)}</strong></div></div>
    <div class="resource-charts">${resourceChart(data,'cpuPercent','CPU theo thời gian','%')}${resourceChart(data,'memoryMiB','RAM theo thời gian','MiB')}</div>
    <div class="table-scroll"><table><thead><tr><th>${tr("CPU trung bình (%)")}</th><th>${tr("CPU cao nhất (%)")}</th><th>${tr("RAM trung bình (MiB)")}</th><th>${tr("RAM cao nhất (MiB)")}</th><th>${tr("Mẫu CPU / RAM / cả hai")}</th></tr></thead><tbody><tr><td>${fmt(summary.cpuAverage,2)}</td><td>${fmt(summary.cpuMax,2)}</td><td>${fmt(summary.memoryAverageMiB,2)}</td><td>${fmt(summary.memoryMaxMiB,2)}</td><td>${fmt(summary.cpuSamples,0)} / ${fmt(summary.memorySamples,0)} / ${fmt(summary.validSamples,0)}</td></tr></tbody></table></div>
    <p class="muted">${tr('RAM = usage trừ inactive_file nếu Docker cung cấp; ')}${tr(samples.some(s=>s.memoryBasis==='raw-usage') ? 'có mẫu dùng usage thô do thiếu trường cache (không hoàn toàn tương đương docker stats).' : 'các mẫu RAM đã trừ phần inactive file cache khi có dữ liệu.')} ${tr('Trung bình là trung bình cộng các mẫu hợp lệ; không phải đỉnh liên tục giữa hai lần lấy mẫu.')}</p>
    ${errors.length ? `<p class="resource-error">${esc(detail(errors.at(-1)?.message || 'Không đọc được Docker'))} · ${tr`${errors.length} lỗi. Giá trị thiếu là N/A, không gán bằng 0.`}</p>` : ''}`;
}
function renderLiveResources(job){
  const selector=$('resource-run'),measurements=job?.resources?.measurements || [];
  if(resourceJobId!==job?.id){resourceJobId=job?.id;selector.value='';}
  let selected=selector.value;
  if(job?.state==='running' && measurements.some(m=>m.balancer===job.currentBalancer))selected=job.currentBalancer;
  selector.innerHTML=measurements.length ? measurements.map(m=>`<option value="${esc(m.balancer)}">${esc(names[m.balancer])} · ${esc(workloadNames[m.workload] || m.workload)}</option>`).join('') : `<option value="">${tr('Đang chờ')}</option>`;
  if(measurements.some(m=>m.balancer===selected))selector.value=selected;
  else if(measurements.length)selector.value=measurements.at(-1).balancer;
  selector.disabled=job?.state==='running' || !measurements.length;
  const data=measurements.find(m=>m.balancer===selector.value);
  $('live-resources').innerHTML=data ? resourcePanel(data) : `<p class="muted">${tr(job ? 'Không có dữ liệu · chờ tiến trình k6 bắt đầu đo container tương ứng.' : 'Đang chờ · CPU: N/A · RAM: N/A. Chỉ thu thập khi benchmark chạy.')}</p>`;
  if(job?.resourceError)$('live-resources').innerHTML+=`<p class="resource-error">${esc(detail(job.resourceError))}</p>`;
}
function renderSavedResources(){
  const batch=results.batches.find(b=>b.id===$('batch').value),workload=$('workload').value;
  const rows = ids.map(balancer => batch?.rows?.find(row => row.balancer === balancer && row.workload === workload) || { balancer });
  renderBenchmarkComparison(batch, workload, rows);
  const measurements=(batch?.resources?.measurements || []).filter(m=>m.workload===workload);
  $('saved-resources').innerHTML=`<h3>${tr('CPU/RAM của đợt đã lưu')}</h3>`+(measurements.length ? measurements.map(resourcePanel).join('') : `<p class="muted">${tr('Chưa thu thập dữ liệu tài nguyên (N/A)')}</p>`)+(batch?.resourceError ? `<p class="resource-error">${esc(detail(batch.resourceError))}</p>`:'');
}
if (typeof document !== 'undefined') {
  $('resource-run').onchange=()=>renderLiveResources(typeof benchmarkJob!=='undefined'?benchmarkJob:null);
  renderLiveResources(typeof benchmarkJob!=='undefined'?benchmarkJob:null);
  renderSavedResources();
}
