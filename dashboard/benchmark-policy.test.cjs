const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const vm=require('node:vm');
const {PINNED_RUN_ID,HISTORICAL_RUN_ID,OFFICIAL_LABEL,OFFICIAL_PROTECTION,applyBenchmarkPolicy}=require('./benchmark-policy.cjs');
const {loadResults}=require('./results.cjs');
const {createResultStorage}=require('./result-storage.cjs');
const {createServer}=require('./server.cjs');
const {scriptConfig}=require('./benchmark-runner.cjs');
test('Pinned official RUN sorts first, exposes default/label and remains protected regardless of other newer complete RUNs',()=>{
  const data=applyBenchmarkPolicy({batches:[{id:'web-full-2099-newer',complete:true},{id:PINNED_RUN_ID,complete:true,origin:'dashboard',canTrash:true},{id:HISTORICAL_RUN_ID,complete:true}]});
  assert.equal(data.batches[0].id,PINNED_RUN_ID);assert.equal(data.defaultBatchId,PINNED_RUN_ID);assert.equal(data.batches[0].officialLabel,OFFICIAL_LABEL);assert.equal(data.batches[0].canTrash,false);assert.equal(data.batches[0].isProtected,true);
  assert.equal(applyBenchmarkPolicy({batches:[{id:HISTORICAL_RUN_ID}]}).defaultBatchId,HISTORICAL_RUN_ID);
});
test('Actual official RUN is read-only verified: 15 PASS rows and 15 distinct CPU/RAM measurements',async()=>{
  const data=await loadResults(),run=data.batches[0];assert.equal(run.id,PINNED_RUN_ID);assert.equal(data.defaultBatchId,PINNED_RUN_ID);
  assert.equal(run.rows.length,15);assert.ok(run.rows.every(r=>r.status==='PASS'));assert.equal(run.resources.measurements.length,15);assert.ok(run.resources.measurements.every(m=>m.summary.validSamples>0));
  assert.equal(new Set(run.resources.measurements.map(m=>m.balancer+'/'+m.workload)).size,15);
});
async function setup(){
  const area=await fs.mkdtemp(path.join(__dirname,'test-trash-pin-')),root=path.join(area,'results'),trash=path.join(area,'trash');await fs.mkdir(root);await fs.mkdir(trash);
  // Fake protected folders only. No operation ever targets real dashboard/results/trash.
  for(const base of [root,trash]){await fs.mkdir(path.join(base,PINNED_RUN_ID));await fs.writeFile(path.join(base,PINNED_RUN_ID,'sentinel.txt'),'PROTECTED FIXTURE');}
  const id='web-ordinary-pin-fixture',dir=path.join(root,id);await fs.mkdir(dir);const config=await scriptConfig('rest');
  await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify({id,directory:dir,producer:'lb-benchmark-dashboard',state:'success',workload:'rest',balancers:['nginx'],currentBalancer:null,total:1,completed:1,startedAt:'2026-11-15T00:00:00Z',finishedAt:'2026-11-15T00:00:31Z',vus:config.vus,duration:config.duration,script:path.relative(path.resolve(__dirname,'..'),config.script),scriptSha256:config.sha256,runs:[{balancer:'nginx',workload:'rest',finishedAt:'2026-11-15T00:00:31Z'}]}));
  await fs.writeFile(path.join(dir,'sentinel.txt'),'ordinary fixture');
  return {root,trash,id,storage:createResultStorage({root,trash})};
}
test('Server policy rejects trash/restore including case variants before touching data; ordinary RUN still moves and restores',async()=>{
  const ctx=await setup();
  for(const id of [PINNED_RUN_ID,PINNED_RUN_ID.toUpperCase()]){
    await assert.rejects(ctx.storage.trash(id),e=>e.status===403 && e.message===OFFICIAL_PROTECTION);
    await assert.rejects(ctx.storage.restore(id),e=>e.status===403);
  }
  assert.equal((await ctx.storage.permission(PINNED_RUN_ID)).canTrash,false);assert.equal((await ctx.storage.permission(PINNED_RUN_ID)).trashReason,OFFICIAL_PROTECTION);
  assert.ok(!(await ctx.storage.listTrash()).batches.some(b=>b.id===PINNED_RUN_ID));
  assert.equal((await ctx.storage.permission(ctx.id)).canTrash,true);await ctx.storage.trash(ctx.id);await ctx.storage.restore(ctx.id);
  assert.equal(await fs.readFile(path.join(ctx.root,ctx.id,'sentinel.txt'),'utf8'),'ordinary fixture');
  for(const base of [ctx.root,ctx.trash])assert.equal(await fs.readFile(path.join(base,PINNED_RUN_ID,'sentinel.txt'),'utf8'),'PROTECTED FIXTURE');
});
test('API rejects official deletion and restore with HTTP 403 even when UI is bypassed',async()=>{
  const ctx=await setup(),server=createServer({resultStorage:ctx.storage});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const action of ['trash','restore']){
      const response=await fetch(`${base}/api/results/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'results'},body:JSON.stringify({id:PINNED_RUN_ID,confirmed:true})});
      assert.equal(response.status,403);assert.equal((await response.json()).error,OFFICIAL_PROTECTION);
    }
  }finally{await new Promise(r=>server.close(r));}
});
test('Frontend pins initial/reload selection, renders label, disables delete with exact tooltip and keeps manual selections',async()=>{
  const actual=await loadResults(),trialId='web-ordinary-ui-fixture';
  const data=applyBenchmarkPolicy({...actual,batches:[...actual.batches,{id:trialId,origin:'dashboard',rows:[],canTrash:true,trashReason:'Allowed fixture'}]});
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,title:'',querySelector:()=>({}),addEventListener:()=>{}});return elements.get(id);};
  const requests=[];
  const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},console,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/api/results'?data:{batches:[]}};}});
  const app=await fs.readFile(path.join(__dirname,'public/app.js'),'utf8');vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/,''),context);
  const manage=await fs.readFile(path.join(__dirname,'public/results-management.js'),'utf8');vm.runInContext(manage.replace(/refreshTrash\(\);\s*$/,''),context);
  el('workload').value='rest';await vm.runInContext('refreshResults()',context);
  assert.equal(el('batch').value,PINNED_RUN_ID);assert.ok(el('batch').innerHTML.indexOf(PINNED_RUN_ID)<el('batch').innerHTML.indexOf(trialId));assert.ok(el('batch').innerHTML.includes('📌 '+OFFICIAL_LABEL));assert.ok(el('batch-note').textContent.includes(OFFICIAL_LABEL));
  assert.equal(el('trash-batch').disabled,true);assert.equal(el('trash-batch').title,OFFICIAL_PROTECTION);
  await vm.runInContext(`refreshResults('${trialId}')`,context);assert.equal(el('batch').value,trialId);assert.equal(el('trash-batch').disabled,false);
  await vm.runInContext('refreshResults()',context);assert.equal(el('batch').value,trialId);
  el('batch').value='';await vm.runInContext('refreshResults()',context);assert.equal(el('batch').value,PINNED_RUN_ID);
  vm.runInContext('openTrashDialog()',context);assert.ok(!requests.some(r=>r.options?.method==='POST'));
  assert.equal(vm.runInContext('officialBatchId()',context),PINNED_RUN_ID);
});
