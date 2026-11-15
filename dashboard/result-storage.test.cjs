const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const {createResultStorage,OFFICIAL}=require('./result-storage.cjs');
const {createServer}=require('./server.cjs');
const {loadResults}=require('./results.cjs');
const {scriptConfig}=require('./benchmark-runner.cjs');
// Never remove test evidence. All moves below stay inside a new test-trash-* sandbox.
async function setup(){
  const area=await fs.mkdtemp(path.join(__dirname,'test-trash-'));
  const root=path.join(area,'results'),trash=path.join(area,'trash');await fs.mkdir(root);
  let busy=false;
  const storage=createResultStorage({root,trash,active:()=>busy});
  return {area,root,trash,storage,setBusy:value=>{busy=value;}};
}
async function fixture(ctx,id='web-fixture-finished',patch={}){
  const directory=path.join(ctx.root,id);await fs.mkdir(directory);
  const config=await scriptConfig('rest');
  const meta={id,directory,producer:'lb-benchmark-dashboard',state:'success',workload:'rest',balancers:['nginx'],currentBalancer:null,total:1,completed:1,
    startedAt:'2026-11-15T10:00:00.000Z',finishedAt:'2026-11-15T10:00:31.000Z',vus:10,duration:'30s',script:path.relative(path.resolve(__dirname,'..'),config.script),scriptSha256:config.sha256,
    runs:[{balancer:'nginx',workload:'rest',status:'PASS',exitCode:0,finishedAt:'2026-11-15T10:00:31.000Z'}],...patch};
  await fs.writeFile(path.join(directory,'metadata.json'),JSON.stringify(meta));
  await fs.writeFile(path.join(directory,'runs.json'),JSON.stringify(meta.runs));
  await fs.copyFile(path.join(__dirname,'../benchmark/results',OFFICIAL,'nginx-rest.json'),path.join(directory,'nginx-rest.json'));
  await fs.writeFile(path.join(directory,'nginx-rest.log'),'TEST FIXTURE ONLY — historical summary copy, no new benchmark\n');
  return directory;
}
async function hashes(dir){
  const items={};for(const file of await fs.readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,file.name);if(file.isDirectory()){for(const [key,value]of Object.entries(await hashes(full)))items[file.name+'/'+key]=value;}
    else items[file.name]=crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');
  }return items;
}
test('Trash/restore moves fake batches without changing bytes; metadata provenance rather than web prefix',async()=>{
  const ctx=await setup(),id='fixture-without-web-prefix';const dir=await fixture(ctx,id);const before=await hashes(dir);
  assert.equal((await ctx.storage.permission(id)).canTrash,true);
  assert.deepEqual(await ctx.storage.trash(id),{id,action:'trashed'});
  assert.deepEqual(await hashes(path.join(ctx.trash,id)),before);
  assert.equal((await loadResults(ctx.root,'dashboard/results')).batches.length,0);
  assert.equal((await ctx.storage.listTrash()).batches[0].id,id);
  await ctx.storage.restore(id);assert.deepEqual(await hashes(dir),before);
  assert.equal((await ctx.storage.listTrash()).batches.length,0);
  const legacyId='web-old-dashboard-format';await fixture(ctx,legacyId,{producer:undefined});
  assert.equal((await ctx.storage.permission(legacyId)).canTrash,true);
});
test('Protected official/legacy IDs, arbitrary paths, malformed IDs and unknown IDs are rejected',async()=>{
  const ctx=await setup();
  for(const id of [OFFICIAL,'legacy-original','legacy-v2']){
    const dir=await fixture(ctx,id);const before=await hashes(dir);
    await assert.rejects(ctx.storage.trash(id),e=>e.status===403);assert.deepEqual(await hashes(dir),before);
  }
  for(const id of ['../benchmark/results',`../${OFFICIAL}`,'..','a/b','a\\b','%2e%2e','C:\\secret','/tmp/run','',null,'a.json'])await assert.rejects(ctx.storage.trash(id),e=>e.status===400);
  await assert.rejects(ctx.storage.trash('unknown-id'),e=>e.status===404);
  assert.equal((await ctx.storage.annotate({batches:[{id:'web-fake',origin:'historical'}]})).batches[0].canTrash,false);
});
test('Prefix alone, foreign source metadata, running/incomplete jobs and temporary writer files cannot be moved',async()=>{
  const ctx=await setup();
  for(const [id,patch]of [['web-foreign',{directory:path.join(ctx.area,'outside')}],['web-producer',{producer:'other-tool'}],['web-running',{state:'running',finishedAt:null}],['web-incomplete',{finishedAt:null}]]){
    await fixture(ctx,id,patch);assert.equal((await ctx.storage.permission(id)).canTrash,false);await assert.rejects(ctx.storage.trash(id));
  }
  await fs.mkdir(path.join(ctx.root,'web-no-metadata'));await assert.rejects(ctx.storage.trash('web-no-metadata'));
  const dir=await fixture(ctx,'web-pending-write');await fs.writeFile(path.join(dir,'metadata.json.tmp'),'pending');
  await assert.rejects(ctx.storage.trash('web-pending-write'),e=>e.status===409);
});
test('In-memory active job and shared runner filesystem lock block both trash and restore',async()=>{
  const ctx=await setup(),id='web-lock-test';await fixture(ctx,id);
  ctx.setBusy(true);await assert.rejects(ctx.storage.trash(id),e=>e.status===409);ctx.setBusy(false);
  await fs.writeFile(path.join(ctx.root,'.benchmark.lock'),'fixture lock');
  assert.equal((await ctx.storage.permission(id)).canTrash,false);await assert.rejects(ctx.storage.trash(id),e=>e.status===409);
  await fs.rename(path.join(ctx.root,'.benchmark.lock'),path.join(ctx.area,'saved-lock-fixture.txt'));
  await ctx.storage.trash(id);ctx.setBusy(true);await assert.rejects(ctx.storage.restore(id),e=>e.status===409);
  assert.equal((await ctx.storage.listTrash()).batches[0].canRestore,false);
});
test('Symlink/junction roots, batch directories and nested links cannot escape allowed directories',async()=>{
  const ctx=await setup(),outside=path.join(ctx.area,'outside');await fs.mkdir(outside);
  await fs.writeFile(path.join(outside,'keep.txt'),'outside fixture must remain unchanged');
  const before=await hashes(outside);
  await fs.symlink(outside,path.join(ctx.root,'web-linked'),'junction');
  await assert.rejects(ctx.storage.trash('web-linked'),e=>e.status===403);
  const dir=await fixture(ctx,'web-nested-link');await fs.symlink(outside,path.join(dir,'linked'),'junction');
  await assert.rejects(ctx.storage.trash('web-nested-link'),e=>e.status===403);
  const linkedRoot=path.join(ctx.area,'linked-root');await fs.symlink(ctx.root,linkedRoot,'junction');
  await assert.rejects(createResultStorage({root:linkedRoot,trash:ctx.trash}).trash('web-nested-link'),e=>e.status===403);
  const linkedTrash=path.join(ctx.area,'linked-trash');await fs.symlink(outside,linkedTrash,'junction');
  await fixture(ctx,'web-bad-trash');await assert.rejects(createResultStorage({root:ctx.root,trash:linkedTrash}).trash('web-bad-trash'),e=>e.status===403);
  assert.deepEqual(await hashes(outside),before);
});
test('Destination collisions preserve both fake copies without overwriting or permanently deleting anything',async()=>{
  const ctx=await setup(),id='web-collision';const dir=await fixture(ctx,id);await ctx.storage.trash(id);
  await fixture(ctx,id);await fs.writeFile(path.join(dir,'sentinel.txt'),'do not overwrite');const before=await hashes(dir);
  await assert.rejects(ctx.storage.restore(id),e=>e.status===409);assert.deepEqual(await hashes(dir),before);
  await assert.rejects(ctx.storage.trash(id),e=>e.status===409);assert.deepEqual(await hashes(dir),before);
  assert.equal((await ctx.storage.listTrash()).batches[0].canRestore,false);
});
async function apiContext(){
  const ctx=await setup(),id='web-api-fixture';await fixture(ctx,id);
  const history=(await loadResults()).batches.filter(b=>b.origin==='historical');
  const read=async()=>{const current=await loadResults(ctx.root,'dashboard/results');return {...current,batches:[...history,...current.batches]};};
  const server=createServer({resultStorage:ctx.storage,loadResults:read});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Action':'results',...headers},body:JSON.stringify(body)});
  return {...ctx,id,server,base,post,close:()=>new Promise(resolve=>server.close(resolve))};
}
test('HTTP API validates confirmation, Origin and ID-only body; lists update after trash and restore of test fixtures',async()=>{
  const ctx=await apiContext();
  try{
    assert.equal((await ctx.post('/api/results/trash',{id:ctx.id})).status,400);
    assert.equal((await ctx.post('/api/results/trash',{id:ctx.id,confirmed:true,path:'../secret'})).status,400);
    assert.equal((await ctx.post('/api/results/trash',{id:ctx.id,confirmed:true},{Origin:'https://evil.example'})).status,403);
    for(const id of [OFFICIAL,'legacy-original','legacy-v2'])assert.equal((await ctx.post('/api/results/trash',{id,confirmed:true})).status,403);
    assert.equal((await ctx.post('/api/results/trash',{id:'../secret',confirmed:true})).status,400);
    const listing=await(await fetch(ctx.base+'/api/results')).json();
    assert.equal(listing.batches.find(b=>b.id===ctx.id).canTrash,true);assert.equal(listing.batches.find(b=>b.id===OFFICIAL).canTrash,false);
    assert.equal((await ctx.post('/api/results/trash',{id:ctx.id,confirmed:true})).status,200);
    assert.ok(!(await(await fetch(ctx.base+'/api/results')).json()).batches.some(b=>b.id===ctx.id));
    assert.equal((await(await fetch(ctx.base+'/api/results/trash')).json()).batches[0].id,ctx.id);
    assert.equal((await ctx.post('/api/results/restore',{id:ctx.id,confirmed:true})).status,200);
    assert.ok((await(await fetch(ctx.base+'/api/results')).json()).batches.some(b=>b.id===ctx.id));
  }finally{await ctx.close();}
});
test('Frontend disables historical deletion; dialog Cancel sends nothing; confirming refreshes official charts and restore selects fixture',async()=>{
  const ctx=await apiContext(),elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,open:false,querySelector:()=>({}),addEventListener:()=>{},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
  const requests=[];
  const context=vm.createContext({document:{getElementById:el,querySelectorAll:()=>[]},console,fetch:async(url,options)=>{requests.push({url,options});return fetch(ctx.base+url,options);}});
  try{
    const app=await fs.readFile(path.join(__dirname,'public/app.js'),'utf8');vm.runInContext(app.replace(/refreshResults\(\);\s*refreshStatus\(\);\s*$/,''),context);
    const manage=await fs.readFile(path.join(__dirname,'public/results-management.js'),'utf8');vm.runInContext(manage.replace(/refreshTrash\(\);\s*$/,''),context);
    el('workload').value='rest';await vm.runInContext(`refreshResults('${OFFICIAL}')`,context);
    assert.equal(el('trash-batch').disabled,true);
    el('batch').value=ctx.id;vm.runInContext('render()',context);assert.equal(el('trash-batch').disabled,false);
    vm.runInContext('openTrashDialog()',context);assert.equal(el('trash-confirm-id').textContent,ctx.id);assert.equal(el('trash-confirm').open,true);
    vm.runInContext('cancelTrashDialog()',context);assert.equal(el('trash-confirm').open,false);assert.ok(!requests.some(r=>r.options?.method==='POST'));
    const before=el('charts').innerHTML;
    vm.runInContext('openTrashDialog()',context);await vm.runInContext('confirmTrash()',context);
    assert.equal(el('batch').value,OFFICIAL);assert.equal(el('trash-batch').disabled,true);
    assert.notEqual(el('charts').innerHTML,before);assert.equal((el('charts').innerHTML.match(/class="chart"/g)||[]).length,4);
    assert.ok(!vm.runInContext('results.batches',context).some(b=>b.id===ctx.id));
    el('trash-selection').value=ctx.id;vm.runInContext('updateBatchActions()',context);await vm.runInContext('restoreBatch()',context);
    assert.equal(el('batch').value,ctx.id);assert.equal(el('charts').innerHTML,before);
    assert.equal(requests.filter(r=>r.options?.method==='POST').length,2);
  }finally{await ctx.close();}
});
