const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const vm=require('node:vm');
const {CONTAINERS,createDockerClient,convertStats,createResourceMonitor,summarize,validateResourceData}=require('./resource-monitor.cjs');
const {createBenchmarkRunner}=require('./benchmark-runner.cjs');
const {loadResults}=require('./results.cjs');
const {createResultStorage}=require('./result-storage.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// Synthetic Docker counters are TEST FIXTURES ONLY; never exposed as real measurements.
function raw(container,i=0){return {id:container+'-fixture-id',name:'/'+container,read:new Date().toISOString(),cpu_stats:{cpu_usage:{total_usage:100+i*300},system_cpu_usage:1000+i*400,online_cpus:4},memory_stats:{usage:20*1048576,stats:{inactive_file:4*1048576}}};}
test('CPU formula preserves >100%, first baseline N/A; RAM MiB and cgroup v1/v2/cache fallback are explicit',()=>{
  const previous=raw('nginx-lb',0),next=raw('nginx-lb',1),value=convertStats(next,previous);
  assert.equal(value.cpuPercent,300);assert.equal(value.memoryMiB,16);assert.equal(value.memoryBasis,'usage-minus-inactive-file');
  assert.equal(convertStats(next,null).cpuPercent,null);
  next.memory_stats.stats={total_inactive_file:5*1048576};assert.equal(convertStats(next,previous).memoryMiB,15);
  next.memory_stats.stats={inactive_file:2*1048576,total_inactive_file:5*1048576};assert.equal(convertStats(next,previous).memoryMiB,15);
  next.memory_stats.stats={};assert.equal(convertStats(next,previous).memoryMiB,20);assert.equal(convertStats(next,previous).memoryBasis,'raw-usage');
  assert.equal(convertStats({},null).memoryMiB,null);assert.equal(convertStats({},null).cpuPercent,null);
  next.cpu_stats.system_cpu_usage=500;assert.equal(convertStats(next,previous).cpuPercent,null);
  next.memory_stats.stats={inactive_file:30*1048576};assert.equal(convertStats(next,previous).memoryMiB,null);
});
test('Docker API client negotiates version, uses fixed container paths and reports missing container / malformed JSON / offline',async()=>{
  let mode='good';const seen=[];
  const server=http.createServer((req,res)=>{
    seen.push(req.url);res.setHeader('Content-Type','application/json');
    if(req.url==='/version')return res.end(JSON.stringify({ApiVersion:'1.52',Os:'linux'}));
    if(req.url==='/v1.52/containers/backend-1/json')return res.end(JSON.stringify({Name:'/backend-1',State:{Running:true}}));
    if(mode==='missing'){res.statusCode=404;return res.end('{"message":"No such container"}');}
    res.end(mode==='invalid' ? '{invalid' : JSON.stringify(raw('nginx-lb')));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port=server.address().port;
  const client=createDockerClient({socketPaths:['fixture'],timeoutMs:150,request:(options,cb)=>{const {socketPath,...rest}=options;return http.request({...rest,hostname:'127.0.0.1',port},cb);}});
  try{
    assert.equal((await client.readStats('nginx-lb')).name,'/nginx-lb');assert.ok(seen.includes('/v1.52/containers/nginx-lb/stats?stream=false&one-shot=true'));
    assert.equal((await client.inspectContainer('backend-1')).State.Running,true);assert.ok(seen.includes('/v1.52/containers/backend-1/json'));
    await assert.rejects(client.inspectContainer('../outside'),/ngoài danh sách/);
    await assert.rejects(client.readStats('../backend-1'),/ngoài danh sách/);
    mode='missing';await assert.rejects(client.readStats('nginx-lb'),/không tồn tại/);
    mode='invalid';await assert.rejects(client.readStats('nginx-lb'),/JSON không hợp lệ/);
  }finally{await new Promise(r=>server.close(r));}
  await assert.rejects(client.readStats('nginx-lb'));
});
test('Collector records timestamps/name, separate valid counts and no samples before start or after stop',async()=>{
  let calls=0;
  const monitor=createResourceMonitor({jobId:'fixture',balancer:'nginx',workload:'rest'},{intervalMs:15,readStats:async name=>raw(name,calls++)});
  await delay(25);assert.equal(calls,0);monitor.start();await delay(80);const data=await monitor.stop(),count=calls;await delay(40);
  assert.equal(calls,count);assert.ok(data.samples.length>=3);assert.equal(data.samples[0].cpuPercent,null);assert.equal(data.summary.cpuAverage,300);assert.equal(data.summary.memoryAverageMiB,16);
  assert.equal(data.summary.validSamples,data.samples.length-1);assert.equal(data.state,'complete');
  assert.ok(data.samples.every(s=>s.container==='nginx-lb' && Date.parse(s.timestamp)>=Date.parse(data.startedAt) && Date.parse(s.timestamp)<=Date.parse(data.finishedAt)));
});
test('Docker API timeout closes an unresponsive stats request without leaving a hanging sampler',async()=>{
  const server=http.createServer((req,res)=>{if(req.url==='/version')res.end(JSON.stringify({ApiVersion:'1.52',Os:'linux'}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const client=createDockerClient({socketPaths:['fixture'],timeoutMs:30,request:(options,cb)=>{const {socketPath,...rest}=options;return http.request({...rest,hostname:'127.0.0.1',port},cb);}});
  try{await assert.rejects(client.readStats('nginx-lb'),/Timeout/);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('Collector Docker failure, mismatched container and invalid counters show nulls/errors, not fake zero',async()=>{
  for(const readStats of [async()=>{throw Error('Docker offline');},async()=>{throw Error('No such container');},async()=>raw('backend-1')]){
    const monitor=createResourceMonitor({jobId:'fixture',balancer:'haproxy',workload:'rest'},{intervalMs:10,readStats});monitor.start();await delay(25);const data=await monitor.stop();
    assert.equal(data.state,'error');assert.equal(data.summary.cpuAverage,null);assert.equal(data.summary.memoryAverageMiB,null);assert.equal(data.summary.validSamples,0);assert.ok(data.errors.length>0);
    assert.ok(data.samples.every(s=>s.cpuPercent===null && s.memoryMiB===null));
  }
});
test('Stop aborts an in-flight stats read; no hanging sampler/timer or points after cancellation',async()=>{
  let aborted=false;
  const monitor=createResourceMonitor({jobId:'fixture',balancer:'envoy',workload:'grpc'},{readStats:(_name,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true}))});
  monitor.start();await delay(5);await Promise.race([monitor.stop(),delay(150).then(()=>{throw Error('Sampler did not stop');})]);assert.equal(aborted,true);assert.equal(monitor.data.samples.length,0);assert.equal(monitor.data.state,'no-data');
});
async function runnerFixture(options={}){
  const root=await fs.mkdtemp(path.join(__dirname,'test-job-resources-'));
  const runner=createBenchmarkRunner({root,findK6:async()=>'/fixture/k6',checkTarget:async()=>{},
    monitorFactory:options.factory || (context=>{let i=0;return createResourceMonitor(context,{intervalMs:10,readStats:async name=>{if(options.offline)throw Error('Docker offline fixture');return raw(name,i++);}});}),
    spawn:(_exe,args,config)=>spawn(process.execPath,[path.join(__dirname,'fixtures/mock-k6.cjs'),...args],{...config,env:{...config.env,DASHBOARD_FIXTURE_DELAY:String(options.childDelay || 80)}})
  });
  return {root,runner};
}
async function finished(runner){const until=Date.now()+5000;while(runner.active()){if(Date.now()>until)throw Error('Fixture job stuck');await delay(10);}return runner.snapshot();}
test('Sequential three-LB mock job isolates resource windows, persists/reads file and preserves benchmark PASS/FAIL',async()=>{
  const {root,runner}=await runnerFixture();await runner.start({balancer:'all',workload:'rest',confirmed:true});const job=await finished(runner);
  assert.equal(job.state,'success');assert.equal(job.runs.length,3);assert.ok(job.runs.every(r=>r.status==='PASS'));
  const data=JSON.parse(await fs.readFile(path.join(job.directory,'resource-metrics.json'),'utf8'));validateResourceData(data,job.id);
  assert.deepEqual(data.measurements.map(m=>m.container),['nginx-lb','haproxy-lb','envoy-lb']);
  for(let i=0;i<3;i++){const m=data.measurements[i];assert.ok(m.summary.cpuSamples>0);assert.ok(m.samples.every(s=>s.container===m.container));if(i)assert.ok(Date.parse(m.startedAt)>=Date.parse(data.measurements[i-1].finishedAt));}
  const loaded=await loadResults(root,'dashboard/results');assert.deepEqual(loaded.batches[0].resources,data);
  const storage=createResultStorage({root,trash:path.join(root,'../resource-trash-fixture')});const before=await fs.readFile(path.join(job.directory,'resource-metrics.json'));
  await storage.trash(job.id);assert.deepEqual(await fs.readFile(path.join(root,'../resource-trash-fixture',job.id,'resource-metrics.json')),before);
  await storage.restore(job.id);assert.deepEqual(await fs.readFile(path.join(job.directory,'resource-metrics.json')),before);assert.deepEqual((await loadResults(root,'dashboard/results')).batches[0].resources,data);
});
test('Offline or monitor initialization error never changes k6 PASS; malformed resource file cannot alter metric rows',async()=>{
  for(const opts of [{offline:true},{factory:()=>{throw Error('Bad Docker socket configuration');}}]){
    const {root,runner}=await runnerFixture(opts);await runner.start({balancer:'nginx',workload:'rest',confirmed:true});const job=await finished(runner);
    assert.equal(job.state,'success');assert.equal(job.runs[0].status,'PASS');assert.equal(job.resources.measurements[0].state,'error');assert.equal(job.resources.measurements[0].summary.cpuAverage,null);
    const batch=(await loadResults(root,'dashboard/results')).batches[0];assert.equal(batch.rows[0].status,'PASS');
    await fs.writeFile(path.join(job.directory,'resource-metrics.json'),'{invalid fixture');
    const invalid=(await loadResults(root,'dashboard/results')).batches[0];assert.equal(invalid.resources,null);assert.ok(invalid.resourceError);assert.equal(invalid.rows[0].rps,batch.rows[0].rps);assert.equal(invalid.rows[0].status,'PASS');
    await fs.writeFile(path.join(job.directory,'resource-metrics.json'),JSON.stringify({schemaVersion:1,jobId:job.id,cpuUnit:'%',memoryUnit:'MiB',measurements:[null]}));
    assert.equal((await loadResults(root,'dashboard/results')).batches[0].resources,null);
  }
});
test('Stopping a mock benchmark stops collection before finalization; resource file is never overwritten',async()=>{
  const {runner}=await runnerFixture({childDelay:1000});await runner.start({balancer:'nginx',workload:'rest',confirmed:true});
  while(!runner.snapshot().resources.measurements[0]?.startedAt)await delay(5);
  await delay(35);runner.stop();const job=await finished(runner),data=job.resources.measurements[0];assert.equal(job.state,'failed');assert.ok(data.finishedAt);assert.ok(data.samples.every(s=>Date.parse(s.timestamp)<=Date.parse(data.finishedAt)));
  const count=data.samples.length;await delay(40);assert.equal(runner.snapshot().resources.measurements[0].samples.length,count);
  const second=await runnerFixture({childDelay:150});await second.runner.start({balancer:'nginx',workload:'rest',confirmed:true});
  const dir=second.runner.snapshot().directory;await fs.writeFile(path.join(dir,'resource-metrics.json'),'sentinel fixture',{flag:'wx'});const done=await finished(second.runner);
  assert.equal(done.state,'success');assert.ok(done.resourceError);assert.equal(await fs.readFile(path.join(dir,'resource-metrics.json'),'utf8'),'sentinel fixture');
});
test('Resource schema refuses wrong run/container, bad samples and inconsistent summaries',()=>{
  const data={schemaVersion:1,jobId:'fixture',workload:'rest',cpuUnit:'%',memoryUnit:'MiB',measurements:[{jobId:'fixture',balancer:'nginx',container:'nginx-lb',workload:'rest',state:'no-data',startedAt:null,finishedAt:null,samples:[],errors:[],summary:summarize([])}]};
  assert.equal(validateResourceData(data,'fixture'),data);
  assert.throws(()=>validateResourceData(data,'another-run'));
  data.measurements[0].container='backend-1';assert.throws(()=>validateResourceData(data,'fixture'));
  data.measurements[0].container='nginx-lb';data.measurements[0].summary.cpuAverage=0;assert.throws(()=>validateResourceData(data,'fixture'));
});
test('Frontend renders CPU >100, RAM MiB, error gaps, per-run selection, and historical no-data without changing existing charts',async()=>{
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,querySelector:()=>({})});return elements.get(id);};
  const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},console});
  const app=await fs.readFile(path.join(__dirname,'public/app.js'),'utf8');vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/,''),context);
  vm.runInContext(await fs.readFile(path.join(__dirname,'public/resources.js'),'utf8'),context);
  assert.ok(el('live-resources').innerHTML.includes('Đang chờ'));assert.ok(el('saved-resources').innerHTML.includes('Chưa thu thập dữ liệu tài nguyên'));
  const start=Date.now()-2000,end=Date.now(),measurements=Object.entries(CONTAINERS).map(([balancer,container])=>{
    const samples=[{timestamp:new Date(start+100).toISOString(),container,cpuPercent:null,memoryMiB:16,memoryBasis:'usage-minus-inactive-file'},
      {timestamp:new Date(start+1000).toISOString(),container,cpuPercent:300,memoryMiB:16,memoryBasis:'usage-minus-inactive-file'}];
    return {balancer,container,workload:'rest',state:'complete',startedAt:new Date(start).toISOString(),finishedAt:new Date(end).toISOString(),samples,errors:[],summary:summarize(samples)};
  });
  context.job={id:'fixture',state:'success',resources:{measurements}};el('resource-run').value='nginx';vm.runInContext('renderLiveResources(job)',context);
  assert.ok(el('live-resources').innerHTML.includes('300 %'));assert.ok(el('live-resources').innerHTML.includes('16 MiB'));assert.ok(!el('live-resources').innerHTML.includes('NaN'));
  el('resource-run').value='haproxy';vm.runInContext('renderLiveResources(job)',context);assert.ok(el('live-resources').innerHTML.includes('haproxy-lb'));
  el('charts').innerHTML='existing-four-charts';el('benchmark-table').innerHTML='existing-table';context.saved={batches:[{id:'fixture',resources:{measurements}}]};vm.runInContext('results=saved',context);el('batch').value='fixture';el('workload').value='rest';vm.runInContext('renderSavedResources()',context);
  assert.equal(el('charts').innerHTML,'existing-four-charts');assert.equal(el('benchmark-table').innerHTML,'existing-table');assert.ok(el('saved-resources').innerHTML.includes('envoy-lb'));
  context.failed={...measurements[0],samples:[{timestamp:new Date(end).toISOString(),container:'nginx-lb',cpuPercent:null,memoryMiB:null}],summary:summarize([]),state:'error',errors:[{message:'Docker offline'}]};
  const panel=vm.runInContext('resourcePanel(failed)',context);assert.ok(panel.includes('N/A %'));assert.ok(panel.includes('N/A MiB'));assert.ok(panel.includes('Docker offline'));assert.ok(!panel.includes('<circle'));
});
