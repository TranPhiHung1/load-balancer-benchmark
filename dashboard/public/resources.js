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
  const measurements=(batch?.resources?.measurements || []).filter(m=>m.workload===workload);
  $('saved-resources').innerHTML=`<h3>${tr('CPU/RAM của đợt đã lưu')}</h3>`+(measurements.length ? measurements.map(resourcePanel).join('') : `<p class="muted">${tr('Chưa thu thập dữ liệu tài nguyên (N/A)')}</p>`)+(batch?.resourceError ? `<p class="resource-error">${esc(detail(batch.resourceError))}</p>`:'');
}
$('resource-run').onchange=()=>renderLiveResources(typeof benchmarkJob!=='undefined'?benchmarkJob:null);
renderLiveResources(typeof benchmarkJob!=='undefined'?benchmarkJob:null);
renderSavedResources();
