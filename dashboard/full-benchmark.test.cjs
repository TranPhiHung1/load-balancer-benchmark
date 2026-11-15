const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const vm=require('node:vm');
const {createFullBenchmarkRunner}=require('./full-benchmark-runner.cjs');
const {PLAN,validFullMetadata}=require('./full-run-schema.cjs');
const {createBenchmarkRunner}=require('./benchmark-runner.cjs');
const {createResourceMonitor,CONTAINERS,validateResourceData}=require('./resource-monitor.cjs');
const {loadResults}=require('./results.cjs');
const {createResultStorage,OFFICIAL}=require('./result-storage.cjs');
const {createServer}=require('./server.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// All data below is TEST ONLY: copied historical k6 JSON and synthetic Docker counters.
async function setup(options={}){
  const root=options.root || await fs.mkdtemp(path.join(__dirname,'test-job-full-'));
  const calls=[],events=[],reads=new Map();let live=0,maxLive=0;
  const raw=name=>{const i=(reads.get(name)||0)+1;reads.set(name,i);return {name:'/'+name,id:name+'-fixture',read:new Date().toISOString(),cpu_stats:{cpu_usage:{total_usage:i*300},system_cpu_usage:i*400,online_cpus:4},memory_stats:{usage:20*1048576,stats:{inactive_file:4*1048576}}};};
  const client={connect:async()=>{if(options.dockerOffline)throw Error('Docker offline fixture');return {apiVersion:'1.52',os:'linux'};},
    inspectContainer:async name=>({Name:'/'+name,Id:name+'-fixture',Image:'sha256:fixture',Config:{Image:'fixture:local'},State:{Running:options.missingContainer!==name,Paused:false,Restarting:false}}),
    readStats:async name=>{if(options.statsDenied)throw Error('Docker Stats EPERM fixture');return raw(name);}};
  const runner=createFullBenchmarkRunner({root,client,findK6:async()=>{if(options.noK6)throw Error('Missing k6 fixture');return '/fixture/k6';},k6Version:async()=> 'k6 TEST FIXTURE',
    checkTarget:async(b,w)=>{if(options.endpointOffline && b==='envoy' && w==='grpc')throw Error('Endpoint offline fixture');},timeoutMs:options.timeoutMs || 2000,
    progress:text=>events.push(text),output:(stream,text)=>events.push(`[${stream}]${text}`),
    monitorFactory:context=>createResourceMonitor(context,{intervalMs:5,readStats:async name=>{if(options.resourceOffline)throw Error('Resource offline after preflight fixture');return raw(name);}}),
    spawn:(executable,args,config)=>{
      const summary=args.find(a=>a.startsWith('--summary-export=')).slice('--summary-export='.length),name=path.basename(summary);
      calls.push({executable,args,config,name});live++;maxLive=Math.max(maxLive,live);
      const child=spawn(process.execPath,[path.join(__dirname,'fixtures/mock-k6.cjs'),...args],{...config,env:{...config.env,DASHBOARD_FIXTURE_MODE:options.failOne && name==='nginx-grpc.json'?'exit-fail':'',DASHBOARD_FIXTURE_DELAY:String(options.longFirst && name==='nginx-http2.json'?3000:options.childDelay || 35)}});
      child.once('close',()=>live--);return child;
    }
  });
  return {root,runner,calls,events,reads,concurrency:()=>maxLive};
}
test('Full preflight refuses Docker offline, missing one of 5 containers, missing k6, bad endpoints and Stats access before spawning',async()=>{
  for(const options of [{dockerOffline:true},{missingContainer:'backend-2'},{noK6:true},{endpointOffline:true},{statsDenied:true}]){
    const ctx=await setup(options);await assert.rejects(ctx.runner.run());assert.equal(ctx.calls.length,0);assert.equal(ctx.runner.snapshot(),null);assert.deepEqual(await fs.readdir(ctx.root),[]);
  }
});
test('15-task fixture FULL RUN uses official order, sequential k6, unique windows/outputs and preserves Dashboard trash/restore',async()=>{
  const ctx=await setup();await ctx.runner.preflight();assert.equal(ctx.calls.length,0);assert.deepEqual(await fs.readdir(ctx.root),[]);assert.equal(ctx.runner.snapshot(),null);
  const job=await ctx.runner.run();
  assert.equal(job.state,'success');assert.equal(job.performanceState,'success');assert.equal(job.resourceState,'complete');assert.equal(job.completed,15);assert.equal(ctx.concurrency(),1);
  assert.deepEqual(job.runs.map(r=>({balancer:r.balancer,workload:r.workload})),PLAN.map(p=>({...p})));assert.equal(ctx.calls.length,15);
  for(const c of ctx.calls){assert.equal(c.config.shell,false);assert.equal(c.config.windowsHide,true);assert.equal(c.executable,'/fixture/k6');}
  assert.ok(ctx.events.some(s=>s.includes('15/15 hoàn thành')));assert.ok(ctx.events.some(s=>s.includes('TEST FIXTURE')));
  const files=await fs.readdir(job.directory);
  for(const p of PLAN){assert.ok(files.includes(`${p.balancer}-${p.workload}.json`));assert.ok(files.includes(`${p.balancer}-${p.workload}.log`));}
  const metadata=JSON.parse(await fs.readFile(path.join(job.directory,'metadata.json'),'utf8'));assert.equal(validFullMetadata(metadata,path.resolve(__dirname,'..')),true);
  const resources=JSON.parse(await fs.readFile(path.join(job.directory,'resource-metrics.json'),'utf8'));validateResourceData(resources,job.id);assert.equal(resources.measurements.length,15);
  for(let i=0;i<15;i++){
    const task=PLAN[i],m=resources.measurements[i];assert.equal(m.balancer,task.balancer);assert.equal(m.workload,task.workload);assert.equal(m.container,CONTAINERS[task.balancer]);assert.equal(m.summary.cpuAverage,300);assert.equal(m.summary.memoryAverageMiB,16);assert.ok(m.summary.validSamples>0);
    assert.ok(m.samples.every(s=>s.container===m.container && Date.parse(s.timestamp)>=Date.parse(m.startedAt) && Date.parse(s.timestamp)<=Date.parse(m.finishedAt)));
    if(i)assert.ok(Date.parse(m.startedAt)>=Date.parse(resources.measurements[i-1].finishedAt));
    const source=JSON.parse(await fs.readFile(path.join(__dirname,'../benchmark/results',OFFICIAL,`${task.balancer}-${task.workload}.json`),'utf8'));
    assert.equal(job.runs[i].status,'PASS');assert.ok(source.metrics);
  }
  const batch=(await loadResults(ctx.root,'dashboard/results')).batches[0];assert.equal(batch.rows.length,15);assert.equal(batch.complete,true);assert.equal(batch.resources.measurements.length,15);
  const storage=createResultStorage({root:ctx.root,trash:ctx.root+'-trash'});assert.equal((await storage.permission(job.id)).canTrash,true);
  const original=await fs.readFile(path.join(job.directory,'resource-metrics.json'));
  await storage.trash(job.id);await storage.restore(job.id);assert.deepEqual(await fs.readFile(path.join(job.directory,'resource-metrics.json')),original);
  assert.equal((await loadResults(ctx.root,'dashboard/results')).batches[0].resources.measurements.length,15);
  await assert.rejects(storage.trash(OFFICIAL),e=>e.status===403);
  const server=createServer({resultStorage:storage,loadResults:()=>loadResults(ctx.root,'dashboard/results')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    const data=await(await fetch(base+'/api/results')).json();assert.equal(data.batches[0].rows.length,15);assert.equal(data.batches[0].canTrash,true);
    const csv=await(await fetch(`${base}/api/export.csv?batch=${job.id}&workload=rest`)).text();assert.equal(csv.trim().split('\r\n').length,4);assert.ok(csv.includes('dashboard/results/'));
  }finally{await new Promise(r=>server.close(r));}
  const next=await setup({root:ctx.root}),second=await next.runner.run();assert.notEqual(second.id,job.id);
  assert.deepEqual(await fs.readFile(path.join(job.directory,'resource-metrics.json')),original);
});
test('A failing k6 workload remains FAIL, logs retained, other workloads continue and no old RUN is overwritten',async()=>{
  const ctx=await setup({failOne:true});
  const old=path.join(ctx.root,'older-run');await fs.mkdir(old);await fs.writeFile(path.join(old,'sentinel.txt'),'existing data');
  const job=await ctx.runner.run();assert.equal(job.completed,15);assert.equal(job.state,'failed');assert.equal(job.runs.find(r=>r.balancer==='nginx' && r.workload==='grpc').status,'FAIL');assert.equal(job.runs.filter(r=>r.status==='PASS').length,14);
  assert.equal(await fs.readFile(path.join(old,'sentinel.txt'),'utf8'),'existing data');assert.notEqual(job.id,'older-run');
  const batch=(await loadResults(ctx.root,'dashboard/results')).batches.find(b=>b.id===job.id);assert.equal(batch.rows.find(r=>r.balancer==='nginx' && r.workload==='grpc').status,'FAIL');
});
test('CPU/RAM sampling errors do not change k6 PASS but mark FULL RUN resource quality as incomplete',async()=>{
  const ctx=await setup({resourceOffline:true}),job=await ctx.runner.run();assert.equal(job.completed,15);assert.equal(job.performanceState,'success');assert.equal(job.resourceState,'error');assert.equal(job.state,'failed');assert.ok(job.runs.every(r=>r.status==='PASS' && r.resourceStatus==='ERROR'));
  assert.ok(job.resources.measurements.every(m=>m.summary.cpuAverage===null && m.summary.memoryAverageMiB===null));
});
test('Cancellation stops owned child/collector, saves partial RUN and shows unexecuted pairs as N/A',async()=>{
  const ctx=await setup({childDelay:3000}),running=ctx.runner.run();
  const end=Date.now()+3000;while(!ctx.runner.snapshot()?.resources.measurements[0]?.startedAt){if(Date.now()>end)throw Error('Mock did not start');await delay(5);}
  await delay(25);ctx.runner.cancel();const job=await running;assert.equal(job.state,'failed');assert.equal(job.cancelRequested,true);assert.equal(ctx.calls.length,1);assert.equal(job.completed,1);
  const before=JSON.stringify(job.resources);await delay(30);assert.equal(JSON.stringify(job.resources),before);
  assert.equal(await fs.lstat(path.join(ctx.root,'.benchmark.lock')).then(()=>true,()=>false),false);
  const batch=(await loadResults(ctx.root,'dashboard/results')).batches[0];assert.equal(batch.rows.length,15);assert.equal(batch.rows.filter(r=>r.status==='N/A').length,14);assert.equal(batch.rows.find(r=>r.balancer==='nginx' && r.workload==='http2').status,'FAIL');
});
test('FULL RUN shares lock with existing web runner; timeout closes task and does not leave the collector running',async()=>{
  const ctx=await setup({longFirst:true,timeoutMs:400}),running=ctx.runner.run();
  while(!ctx.runner.snapshot())await delay(5);
  const web=createBenchmarkRunner({root:ctx.root,findK6:async()=>'/mock/k6',checkTarget:async()=>{},spawn:()=>{throw Error('Must not spawn web job');}});
  await assert.rejects(web.start({balancer:'nginx',workload:'rest',confirmed:true}),e=>e.status===409);
  const job=await running;assert.equal(job.completed,15);assert.equal(job.runs[0].timedOut,true);assert.equal(job.runs[0].status,'FAIL');assert.ok(job.resources.measurements.every(m=>m.finishedAt || !m.startedAt));
});
test('Schema v2 rejects duplicate LB/workload or foreign work items; saved resource UI filters exactly 3 measurements per workload',async()=>{
  const ctx=await setup(),job=await ctx.runner.run();
  const invalid=JSON.parse(JSON.stringify(job.resources));invalid.measurements[1]=invalid.measurements[0];assert.throws(()=>validateResourceData(invalid,job.id));
  const foreign=JSON.parse(JSON.stringify(job.resources));foreign.measurements[0].workload='unknown';assert.throws(()=>validateResourceData(foreign,job.id));
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',querySelector:()=>({})});return elements.get(id);};
  const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},console});
  const app=await fs.readFile(path.join(__dirname,'public/app.js'),'utf8');vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/,''),context);
  vm.runInContext(await fs.readFile(path.join(__dirname,'public/resources.js'),'utf8'),context);
  context.data=await loadResults(ctx.root,'dashboard/results');vm.runInContext('results=data',context);el('batch').value=job.id;
  for(const workload of ['rest','keepalive-on','keepalive-off','http2','grpc']){
    el('workload').value=workload;vm.runInContext('render()',context);
    assert.equal((el('charts').innerHTML.match(/class="chart"/g)||[]).length,4);
    assert.equal((el('saved-resources').innerHTML.match(/class="resource-heading"/g)||[]).length,3);
    assert.equal((el('saved-resources').innerHTML.match(/class="resource-chart"/g)||[]).length,6);
    assert.ok(el('benchmark-table').innerHTML.includes('Thành công'));
  }
});
