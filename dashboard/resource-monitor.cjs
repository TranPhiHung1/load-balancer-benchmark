const http=require('node:http');
const CONTAINERS=Object.freeze({nginx:'nginx-lb',haproxy:'haproxy-lb',envoy:'envoy-lb'});
const number=v=>typeof v==='number' && Number.isFinite(v) ? v : null;
function socketPaths(){
  const custom=process.env.DASHBOARD_DOCKER_SOCKET;
  if(custom){
    if(!custom.startsWith('\\\\.\\pipe\\') && !custom.startsWith('/'))throw Error('DASHBOARD_DOCKER_SOCKET chỉ nhận named pipe hoặc Unix socket cục bộ');
    return [custom];
  }
  return process.platform==='win32' ? ['\\\\.\\pipe\\docker_engine','\\\\.\\pipe\\dockerDesktopLinuxEngine'] : ['/var/run/docker.sock'];
}
function createDockerClient(options={}){
  const request=options.request || http.request,paths=options.socketPaths || socketPaths();
  let endpoint=null,version=null;
  function get(socketPath,url,signal){
    return new Promise((resolve,reject)=>{
      let body='',finished=false;
      const finish=(err,data)=>{if(finished)return;finished=true;clearTimeout(timer);err ? reject(err) : resolve(data);};
      const req=request({socketPath,path:url,method:'GET',signal},res=>{
        res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;if(body.length>2*1024*1024)req.destroy(Error('Phản hồi Docker quá lớn'));});
        res.on('error',e=>finish(e));
        res.on('end',()=>{
          if(res.statusCode!==200)return finish(Error(res.statusCode===404 ? 'Docker: container không tồn tại hoặc endpoint không được hỗ trợ (HTTP 404)' : `Docker HTTP ${res.statusCode}: ${body.slice(0,180)}`));
          try{finish(null,JSON.parse(body));}catch{finish(Error('Docker trả JSON không hợp lệ'));}
        });
      });
      const timer=setTimeout(()=>req.destroy(Error('Timeout đọc Docker Engine (1,5 giây)')),options.timeoutMs || 1500);
      req.on('error',e=>finish(e));req.end();
    });
  }
  async function connect(signal){
    let last;
    for(const candidate of paths){
      try{
        const data=await get(candidate,'/version',signal);
        if(!/^\d+\.\d+$/.test(data.ApiVersion || ''))throw Error('Docker thiếu ApiVersion hợp lệ');
        if(data.Os && data.Os!=='linux')throw Error('Monitor này yêu cầu Linux containers; không diễn giải CPU của Windows containers');
        endpoint=candidate;version=data.ApiVersion;return {apiVersion:version,os:data.Os || 'unknown'};
      }catch(e){last=e;if(signal?.aborted)throw e;}
    }
    throw Error('Không kết nối được Docker Engine cục bộ: '+(last?.message || 'không có socket'));
  }
  async function readStats(container,signal){
    if(!Object.values(CONTAINERS).includes(container))throw Error('Container ngoài danh sách cho phép');
    if(!endpoint)await connect(signal);
    return get(endpoint,`/v${version}/containers/${container}/stats?stream=false&one-shot=true`,signal);
  }
  async function inspectContainer(container,signal){
    if(![...Object.values(CONTAINERS),'backend-1','backend-2'].includes(container))throw Error('Container ngoài danh sách cho phép');
    if(!endpoint)await connect(signal);
    return get(endpoint,`/v${version}/containers/${container}/json`,signal);
  }
  return {connect,readStats,inspectContainer};
}
function convertStats(raw,previous){
  const cpu=raw?.cpu_stats,old=previous?.cpu_stats;
  let cpuPercent=null,memoryMiB=null,memoryBasis=null;
  const total=number(cpu?.cpu_usage?.total_usage),oldTotal=number(old?.cpu_usage?.total_usage);
  const system=number(cpu?.system_cpu_usage),oldSystem=number(old?.system_cpu_usage);
  const cores=number(cpu?.online_cpus) ?? (Array.isArray(cpu?.cpu_usage?.percpu_usage) ? cpu.cpu_usage.percpu_usage.length : null);
  if(total!==null && oldTotal!==null && system!==null && oldSystem!==null && cores>0 && total>=oldTotal && system>oldSystem)cpuPercent=(total-oldTotal)/(system-oldSystem)*cores*100;
  const usage=number(raw?.memory_stats?.usage);
  const stats=raw?.memory_stats?.stats;
  // cgroup v1 may expose both fields; Docker CLI uses the hierarchical total there.
  const inactive=number(stats?.total_inactive_file) ?? number(stats?.inactive_file);
  if(usage!==null && usage>=0){
    if(inactive!==null && inactive>=0 && inactive<=usage){memoryMiB=(usage-inactive)/1048576;memoryBasis='usage-minus-inactive-file';}
    else if(inactive===null){memoryMiB=usage/1048576;memoryBasis='raw-usage';}
  }
  return {cpuPercent:number(cpuPercent),memoryMiB:number(memoryMiB),memoryBasis};
}
function summarize(samples){
  const cpu=samples.map(s=>s.cpuPercent).filter(v=>number(v)!==null),ram=samples.map(s=>s.memoryMiB).filter(v=>number(v)!==null);
  const avg=list=>list.length ? list.reduce((a,b)=>a+b,0)/list.length : null;
  return {cpuAverage:avg(cpu),cpuMax:cpu.length ? Math.max(...cpu):null,memoryAverageMiB:avg(ram),memoryMaxMiB:ram.length ? Math.max(...ram):null,
    validSamples:samples.filter(s=>number(s.cpuPercent)!==null && number(s.memoryMiB)!==null).length,cpuSamples:cpu.length,memorySamples:ram.length};
}
function validateResourceData(data,id){
  const full=data?.schemaVersion===2 && data.workload==='all';
  if((data?.schemaVersion!==1 && !full) || data.jobId!==id || !Array.isArray(data.measurements) || data.measurements.length>(full?15:3) || data.cpuUnit!=='%' || data.memoryUnit!=='MiB')throw Error('Schema tài nguyên không hợp lệ');
  const seen=new Set();
  for(const m of data.measurements){
    const key=m?.balancer+'/'+m?.workload;
    if(!m || m.jobId!==id || (full ? !['rest','keepalive-on','keepalive-off','http2','grpc'].includes(m.workload) : m.workload!==data.workload) || CONTAINERS[m.balancer]!==m.container || seen.has(key) || !['waiting','collecting','complete','no-data','error'].includes(m.state) || !Array.isArray(m.samples) || m.samples.length>1000 || !Array.isArray(m.errors))throw Error('Bài đo tài nguyên không hợp lệ');
    seen.add(key);
    let last=Date.parse(m.startedAt);
    if(m.samples.length && (!Number.isFinite(last) || !Number.isFinite(Date.parse(m.finishedAt))))throw Error('Thiếu khoảng thời gian đo');
    for(const sample of m.samples){
      const at=Date.parse(sample?.timestamp);
      if(!sample || sample.container!==m.container || !Number.isFinite(at) || at<last || at>Date.parse(m.finishedAt) ||
        ![sample.cpuPercent,sample.memoryMiB].every(v=>v===null || (number(v)!==null && v>=0)))throw Error('Mẫu tài nguyên không hợp lệ hoặc ngoài khoảng đo');
      last=at;
    }
    const expected=summarize(m.samples);
    if(!m.summary || Object.keys(expected).some(k=>m.summary[k]!==expected[k]))throw Error('Thống kê tài nguyên không khớp các mẫu đã lưu');
  }
  return data;
}
function createResourceMonitor(context,options={}){
  const container=CONTAINERS[context.balancer];if(!container)throw Error('Load Balancer không hợp lệ');
  const client=options.client || createDockerClient(),read=options.readStats || ((name,signal)=>client.readStats(name,signal));
  const intervalMs=options.intervalMs || 1000;
  const data={...context,container,source:'Docker Engine API',intervalMs,cpuUnit:'%',memoryUnit:'MiB',
    cpuDefinition:'delta(container CPU) / delta(system CPU) × online CPUs × 100; baseline inside this run',
    memoryDefinition:'Linux usage - inactive_file (cgroup v2) / total_inactive_file (v1), divided by 1048576; raw usage explicitly marked when cache field absent',
    startedAt:null,finishedAt:null,state:'waiting',samples:[],errors:[],summary:summarize([])};
  let stopped=false,timer=null,pending=Promise.resolve(),controller=null,previous=null,containerId=null,started=false;
  function recordError(message){data.errors.push({timestamp:new Date().toISOString(),message});data.state='error';}
  async function tick(){
    if(stopped)return;
    const began=Date.now();controller=new AbortController();
    try{
      const raw=await read(container,controller.signal);
      if(stopped)return;
      const readAt=Date.parse(raw?.read);
      if(!Number.isFinite(readAt) || readAt<Date.parse(data.startedAt) || readAt>Date.now()+1000)throw Error('Timestamp Docker không nằm trong khoảng đo hoặc không hợp lệ');
      if(raw.name && raw.name.replace(/^\//,'')!==container)throw Error('Docker trả sai tên container');
      if(containerId && raw.id && containerId!==raw.id){previous=null;throw Error('Container đã được tạo lại trong lúc đo; bỏ mẫu chuyển tiếp');}
      if(raw.id)containerId=raw.id;
      const values=convertStats(raw,previous);
      const point={timestamp:new Date().toISOString(),dockerReadAt:raw.read,container,...values,cpuBaselineAt:previous?.read || null,error:null};
      if(values.memoryMiB===null || (previous && values.cpuPercent===null)){point.error='Thiếu hoặc không hợp lệ bộ đếm CPU/RAM Docker';recordError(point.error);}
      else data.state='collecting';
      data.samples.push(point);previous=raw;
    }catch(e){
      if(!stopped){const message=e.message;recordError(message);data.samples.push({timestamp:new Date().toISOString(),container,cpuPercent:null,memoryMiB:null,memoryBasis:null,error:message});previous=null;}
    }finally{
      data.summary=summarize(data.samples);
      if(!stopped)timer=setTimeout(()=>{pending=tick();},Math.max(0,intervalMs-(Date.now()-began)));
    }
  }
  function start(){if(started || stopped)return;started=true;data.startedAt=new Date().toISOString();data.state='collecting';pending=tick();}
  async function stop(){
    if(!stopped){stopped=true;data.finishedAt=started ? new Date().toISOString():null;clearTimeout(timer);controller?.abort();}
    await pending;data.summary=summarize(data.samples);
    data.state=data.errors.length ? 'error' : data.summary.cpuSamples || data.summary.memorySamples ? 'complete' : 'no-data';
    return data;
  }
  return {data,start,stop};
}
module.exports={CONTAINERS,createDockerClient,convertStats,summarize,createResourceMonitor,validateResourceData};
