const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vm = require('node:vm');
const { createBenchmarkRunner, findK6, scriptConfig, argumentsFor, cleanEnvironment } = require('./benchmark-runner.cjs');
const { createServer } = require('./server.cjs');
const { loadResults } = require('./results.cjs');
async function waitFor(runner) {
  const end=Date.now()+7000;
  while(runner.active()) { if(Date.now()>end) throw Error('Mock job did not finish'); await new Promise(r=>setTimeout(r,20)); }
  return runner.snapshot();
}
async function setup(options={}) {
  const root=await fs.mkdtemp(path.join(__dirname,'test-job-'));
  const calls=[];
  const runner=createBenchmarkRunner({root,findK6:async()=>'/mock/k6',checkTarget:async()=>{}, ...options,
    monitorFactory:context=>require('./resource-monitor.cjs').createResourceMonitor(context,{readStats:async()=>{throw Error('TEST FIXTURE: Docker offline');}}),
    spawn:(executable,args,config)=>{
      calls.push({executable,args,config});
      return spawn(process.execPath,[path.join(__dirname,'fixtures/mock-k6.cjs'),...args],{
        ...config,env:{...config.env,DASHBOARD_FIXTURE_MODE:options.mode || '',DASHBOARD_FIXTURE_DELAY:String(options.delay || 30)}
      });
    }
  });
  return {root,runner,calls,cleanup:async()=>{if(runner.snapshot()?.state==='running')runner.stop();await waitFor(runner);await fs.rm(root,{recursive:true});}};
}
test('Read exact script settings and build only the existing runner CLI for all 5 workloads',async()=>{
  for(const workload of ['rest','keepalive-on','keepalive-off','http2','grpc']) {
    const config=await scriptConfig(workload);
    assert.equal(config.vus,10);assert.equal(config.duration,'30s');assert.equal(config.sha256.length,64);
    const args=argumentsFor('envoy',workload,'fixture.json',config);
    assert.equal(args[0],'run'); assert.ok(args.includes('--summary-export=fixture.json'));
    assert.ok(args.includes(workload==='grpc' ? 'GRPC_ADDR=localhost:9442' : `BASE_URL=${workload==='http2' ? 'https://localhost:8442' : 'http://localhost:8082'}`));
    assert.equal(args.at(-1),config.script);
    if(workload.startsWith('keepalive')) assert.ok(args.includes('KEEP_ALIVE='+ (workload==='keepalive-on'?'on':'off')));
  }
  assert.throws(()=>argumentsFor('http://evil','rest','x',{}));
});
test('No real k6: mocked process logs, metadata, sequential all-LB runs and unique append-only directories',async()=>{
  const ctx=await setup({delay:70});
  try {
    await ctx.runner.start({balancer:'all',workload:'rest',confirmed:true});
    const first=await waitFor(ctx.runner);
    assert.equal(first.state,'success');assert.equal(first.completed,3);
    assert.deepEqual(first.runs.map(r=>r.balancer),['nginx','haproxy','envoy']);
    assert.ok(first.logs.includes('[stdout]'));assert.ok(first.logs.includes('[stderr]'));assert.ok(first.logs.includes('TEST FIXTURE'));
    for(let i=1;i<first.runs.length;i++) assert.ok(Date.parse(first.runs[i].startedAt)>=Date.parse(first.runs[i-1].finishedAt));
    for(const c of ctx.calls){assert.equal(c.config.shell,false);assert.equal(c.config.windowsHide,true);assert.equal(c.executable,'/mock/k6');}
    const metadata=JSON.parse(await fs.readFile(path.join(first.directory,'metadata.json'),'utf8'));
    assert.equal(metadata.state,'success');assert.equal(metadata.vus,10);assert.equal(metadata.duration,'30s');
    const saved=await fs.readFile(path.join(first.directory,'nginx-rest.json'),'utf8');
    const batches=await loadResults(ctx.root,'dashboard/results');
    assert.equal(batches.batches[0].rows.length,3);assert.ok(batches.batches[0].rows.every(r=>r.status==='PASS'));
    await ctx.runner.start({balancer:'nginx',workload:'grpc',confirmed:true});
    const second=await waitFor(ctx.runner);
    assert.notEqual(first.id,second.id);assert.equal(await fs.readFile(path.join(first.directory,'nginx-rest.json'),'utf8'),saved);
    const data=await loadResults(ctx.root,'dashboard/results'),batch=data.batches.find(b=>b.id===second.id);
    assert.equal(batch.rows.length,1);assert.equal(batch.rows[0].workload,'grpc');assert.equal(batch.rows[0].status,'PASS');
    assert.ok(batch.rows[0].source.startsWith('dashboard/results/'));
  } finally {await ctx.cleanup();}
});
test('Missing k6 and offline preflight spawn nothing; malicious values and missing confirmation are rejected',async()=>{
  const oldPath=process.env.PATH;process.env.PATH='';
  try{await assert.rejects(findK6(),/Không tìm thấy k6/);}finally{process.env.PATH=oldPath;}
  for(const options of [{findK6:async()=>{throw Object.assign(Error('missing k6'),{status:503});}},{checkTarget:async()=>{throw Error('ECONNREFUSED');}}]) {
    const ctx=await setup(options);
    try {await assert.rejects(ctx.runner.start({balancer:'nginx',workload:'rest',confirmed:true}));assert.equal(ctx.calls.length,0);assert.deepEqual(await fs.readdir(ctx.root),[]);}
    finally{await ctx.cleanup();}
  }
  const ctx=await setup();
  try {
    for(const input of [null,{}, {balancer:'nginx;calc.exe',workload:'rest',confirmed:true},{balancer:'nginx',workload:'../../secret',confirmed:true},{balancer:'nginx',workload:'rest',confirmed:false},{balancer:'nginx',workload:'rest',confirmed:true,command:'cmd.exe'}]) await assert.rejects(ctx.runner.start(input));
    assert.equal(ctx.calls.length,0);
  }finally{await ctx.cleanup();}
});
test('One job at a time, including preflight and separate Dashboard instances sharing output root',async()=>{
  const ctx=await setup({delay:500});
  try {
    const starting=ctx.runner.start({balancer:'nginx',workload:'rest',confirmed:true});
    await assert.rejects(ctx.runner.start({balancer:'envoy',workload:'rest',confirmed:true}),e=>e.status===409);
    await starting;
    const other=createBenchmarkRunner({root:ctx.root,findK6:async()=>'/mock/k6',checkTarget:async()=>{},spawn:()=>{throw Error('Must not spawn');}});
    await assert.rejects(other.start({balancer:'envoy',workload:'rest',confirmed:true}),e=>e.status===409);
    ctx.runner.stop(); const stopped=await waitFor(ctx.runner);assert.equal(stopped.state,'failed');assert.equal(stopped.cancelRequested,true);
    assert.equal(await fs.stat(path.join(ctx.root,'.benchmark.lock')).then(()=>true,()=>false),false);
  }finally{await ctx.cleanup();}
});
test('Malformed JSON, nonzero exit and timeout cannot become PASS; stop prevents following LBs',async()=>{
  for(const options of [{mode:'invalid'},{mode:'exit-fail'},{delay:5000,timeoutMs:80}]) {
    const ctx=await setup(options);
    try {
      await ctx.runner.start({balancer:'nginx',workload:'rest',confirmed:true});
      const job=await waitFor(ctx.runner);assert.equal(job.state,'failed');assert.equal(job.runs[0].status,'FAIL');
      const results=await loadResults(ctx.root,'dashboard/results');assert.equal(results.batches[0].rows[0].status,'FAIL');
    }finally{await ctx.cleanup();}
  }
  const ctx=await setup({delay:5000});
  try {await ctx.runner.start({balancer:'all',workload:'rest',confirmed:true});ctx.runner.stop();await waitFor(ctx.runner);assert.equal(ctx.calls.length,0,'Immediate stop before log open must not spawn any k6 process');assert.equal(ctx.runner.snapshot().state,'failed');}
  finally{await ctx.cleanup();}
});
test('Benchmark API auth/confirmation, polling, logs, config, stop and existing demo exclusion (mock only)',async()=>{
  const ctx=await setup({delay:1000}),server=createServer({benchmarkRunner:ctx.runner});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const options={method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'benchmark'},body:JSON.stringify({balancer:'nginx',workload:'rest',confirmed:true})};
  try{
    assert.equal((await(await fetch(base+'/api/benchmark/config')).json()).available,true);
    assert.equal((await(await fetch(base+'/api/benchmark/status')).json()).job,null);
    assert.equal(ctx.calls.length,0);
    assert.equal((await fetch(base+'/api/benchmark/start',{method:'POST'})).status,403);
    assert.equal((await fetch(base+'/api/benchmark/start',{...options,headers:{...options.headers,Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(base+'/api/benchmark/start',{...options,body:'{bad'})).status,400);
    assert.equal((await fetch(base+'/api/benchmark/start',{...options,body:JSON.stringify({balancer:'nginx',workload:'rest'})})).status,400);
    assert.equal((await fetch(base+'/api/benchmark/start',options)).status,202);
    assert.equal((await fetch(base+'/api/benchmark/start',options)).status,409);
    assert.equal((await fetch(base+'/api/round-robin/nginx',{method:'POST',headers:{'X-Dashboard-Action':'demo'}})).status,409);
    assert.equal((await(await fetch(base+'/api/benchmark/status')).json()).job.state,'running');
    assert.equal((await fetch(base+'/api/benchmark/stop',{method:'POST',headers:{'X-Dashboard-Action':'benchmark'}})).status,200);
    await waitFor(ctx.runner);
    const status=await(await fetch(base+'/api/benchmark/status')).json();assert.equal(status.job.state,'failed');assert.equal(status.busy,false);
    assert.equal((await fetch(base+'/benchmark.js')).status,200);
  }finally{await new Promise(resolve=>server.close(resolve));await ctx.cleanup();}
});
test('API returns 503 for missing k6 and offline Load Balancer without spawning any child',async()=>{
  for(const options of [{findK6:async()=>{throw Object.assign(Error('Không tìm thấy k6'),{status:503});}},{checkTarget:async()=>{throw Error('LB offline');}}]) {
    const ctx=await setup(options),server=createServer({benchmarkRunner:ctx.runner});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/benchmark/start`,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'benchmark'},body:JSON.stringify({balancer:'nginx',workload:'rest',confirmed:true})});
      assert.equal(response.status,503);assert.equal(ctx.calls.length,0);assert.deepEqual(await fs.readdir(ctx.root),[]);
    }finally{await new Promise(resolve=>server.close(resolve));await ctx.cleanup();}
  }
});
test('Frontend confirmation prevents launch; polling selects the finished batch/workload and renders real fixture metrics with other LBs N/A',async()=>{
  const ctx=await setup();
  try {
    await ctx.runner.start({balancer:'nginx',workload:'rest',confirmed:true});const job=await waitFor(ctx.runner);
    const data=await loadResults(ctx.root,'dashboard/results');
    const elements=new Map(),el=id=>{
      if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,scrollTop:0,scrollHeight:0,clientHeight:0,querySelector:()=>({})});
      return elements.get(id);
    };
    const requests=[];
    const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},window:{confirm:()=>false},setInterval:()=>{},console,
      fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=> url==='/api/results' ? data : {job,busy:false}};}});
    const app=await fs.readFile(path.join(__dirname,'public/app.js'),'utf8');
    vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/,''),context);
    const code=await fs.readFile(path.join(__dirname,'public/benchmark.js'),'utf8');
    vm.runInContext(code.replace(/initBenchmark\(\);\s*setInterval\(pollBenchmark,1000\);\s*$/,''),context);
    context.config={available:true,workloads:[{id:'rest',vus:10,duration:'30s'}]};
    vm.runInContext('benchmarkConfig=config',context);el('bench-workload').value='rest';el('bench-balancer').value='nginx';
    await vm.runInContext('startBenchmark()',context);assert.equal(requests.length,0,'Cancel confirmation must not POST');
    await vm.runInContext('pollBenchmark()',context);
    assert.equal(el('batch').value,job.id);assert.equal(el('workload').value,'rest');
    assert.ok(el('benchmark-table').innerHTML.includes('4,403.789'));
    assert.equal((el('benchmark-table').innerHTML.match(/N\/A/g)||[]).length,14);
    assert.equal((el('charts').innerHTML.match(/class="chart"/g)||[]).length,4);
    assert.ok(el('bench-progress').textContent.includes('1/1'));assert.equal(el('bench-state').textContent,'THÀNH CÔNG');
    assert.ok(!requests.some(r=>r.url==='/api/benchmark/start'));
  }finally{await ctx.cleanup();}
});
