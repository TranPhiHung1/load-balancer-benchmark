const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn,execFile}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {promisify}=require('node:util');
const {findK6,scriptConfig,argumentsFor,checkTarget,cleanEnvironment,OUTPUT}=require('./benchmark-runner.cjs');
const {normalize}=require('./results.cjs');
const {assertNoFailover}=require('./failover.cjs');
const {CONTAINERS,createDockerClient,createResourceMonitor,convertStats}=require('./resource-monitor.cjs');
const {FULL_PRODUCER,BALANCERS,ORDER,PLAN}=require('./full-run-schema.cjs');
const REPO=path.resolve(__dirname,'..');
function createFullBenchmarkRunner(options={}){
  const root=path.resolve(options.root || OUTPUT),client=options.client || createDockerClient();
  const locate=options.findK6 || findK6,check=options.checkTarget || checkTarget,launch=options.spawn || spawn;
  const getVersion=options.k6Version || (async exe=>(await promisify(execFile)(exe,['version'],{timeout:5000,windowsHide:true,shell:false,env:cleanEnvironment()})).stdout.trim());
  const monitorFactory=options.monitorFactory || (context=>createResourceMonitor(context,{client}));
  const output=options.output || ((stream,text)=>(stream==='stderr'?process.stderr:process.stdout).write(text));
  const progress=options.progress || (text=>process.stdout.write(text+'\n'));
  const timeoutMs=options.timeoutMs || 90000;
  const controller=new AbortController();
  let child=null,monitor=null,current=null,lock=null,busy=false,cancelled=false;
  const checkCancel=()=>{if(cancelled)throw Error('Đã hủy FULL RUN');};
  function cancel(){cancelled=true;controller.abort();void monitor?.stop();if(child){const owned=child;owned.kill('SIGINT');const timer=setTimeout(()=>{if(child===owned)owned.kill('SIGKILL');},3000);timer.unref();}}
  async function preflight(){
    checkCancel();const executable=await locate();const k6Version=await getVersion(executable);checkCancel();
    const engine=await client.connect(controller.signal),containers=[];
    for(const name of [...Object.values(CONTAINERS),'backend-1','backend-2']){
      checkCancel();const info=await client.inspectContainer(name,controller.signal);
      if(info.Name!==`/${name}` || info.State?.Running!==true || info.State?.Paused || info.State?.Restarting)throw Error(`Container ${name} không chạy ổn định`);
      containers.push({name,id:info.Id,imageId:info.Image,image:info.Config?.Image,state:'running'});
    }
    const configs={};
    for(const workload of ORDER){checkCancel();configs[workload]=await scriptConfig(workload);}
    for(const task of PLAN){checkCancel();await check(task.balancer,task.workload);}
    for(const container of Object.values(CONTAINERS)){
      checkCancel();const raw=await client.readStats(container,controller.signal);
      if(raw?.name?.replace(/^\//,'')!==container || !Number.isFinite(Date.parse(raw.read)) || convertStats(raw,null).memoryMiB===null ||
        !Number.isFinite(raw.cpu_stats?.cpu_usage?.total_usage) || !Number.isFinite(raw.cpu_stats?.system_cpu_usage) || !(raw.cpu_stats?.online_cpus || raw.cpu_stats?.cpu_usage?.percpu_usage?.length))throw Error(`Không đọc được quyền/counter Docker Stats hợp lệ cho ${container}`);
    }
    checkCancel();return {executable,k6Version,engine,containers,configs,checkedAt:new Date().toISOString()};
  }
  const written=new Set();
  async function write(name,data){
    const file=path.join(current.directory,name),body=typeof data==='string'?data:JSON.stringify(data,null,2);
    if(!written.has(name)){await fs.writeFile(file,body,{encoding:'utf8',flag:'wx'});written.add(name);}
    else{const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,body,{encoding:'utf8',flag:'wx'});await fs.rename(temp,file);}
  }
  async function save(){await write('runs.json',current.runs);await write('resource-metrics.json',current.resources);const {resources,...metadata}=current;await write('metadata.json',metadata);}
  async function execute(executable,args,logfile){
    const log=await fs.open(logfile,'wx');let writes=Promise.resolve(),logError=null;
    const append=(kind,text)=>{output(kind,text);writes=writes.then(()=>log.write(`[${kind}] ${text}`)).catch(e=>{logError=e;child?.kill();});};
    try{
      checkCancel();return await new Promise(resolve=>{
        let timedOut=false,spawnError=null,forceTimer;
        try{child=launch(executable,args,{cwd:REPO,env:cleanEnvironment(),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
        catch(e){return resolve({exitCode:null,error:e.message});}
        child.once('spawn',()=>{if(!cancelled)monitor.start();});
        const timer=setTimeout(()=>{timedOut=true;void monitor.stop();child.kill('SIGINT');forceTimer=setTimeout(()=>child?.kill('SIGKILL'),3000);},timeoutMs);
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        child.stdout.on('data',text=>append('stdout',text));child.stderr.on('data',text=>append('stderr',text));child.once('error',e=>{spawnError=e.message;});
        child.once('close',(code,signal)=>{void monitor.stop();clearTimeout(timer);clearTimeout(forceTimer);child=null;resolve({exitCode:code,signal,timedOut,error:timedOut?'Timeout k6':spawnError});});
      });
    }finally{await monitor?.stop();await writes;await log.close();if(logError)throw logError;}
  }
  async function acquire(){
    await fs.mkdir(root,{recursive:true});const stat=await fs.lstat(root);
    const real=path.resolve(await fs.realpath(root)),same=process.platform==='win32'?real.toLowerCase()===root.toLowerCase():real===root;
    if(stat.isSymbolicLink() || !stat.isDirectory() || !same)throw Error('Output root không được là symlink/junction');
    try{lock=await fs.open(path.join(root,'.benchmark.lock'),'wx');}catch(e){if(e.code==='EEXIST')throw Error('Benchmark/thao tác dữ liệu khác đang chạy hoặc còn khóa phiên bị ngắt');throw e;}
    await lock.writeFile(JSON.stringify({pid:process.pid,operation:'full-benchmark'}));
    await assertNoFailover(root);
  }
  async function run(){
    if(busy || current)throw Error('Runner này chỉ chạy một FULL RUN');busy=true;
    try{
      await acquire();progress('Kiểm tra k6, Docker, 5 container, 15 endpoint và quyền Docker Stats…');
      const ready=await preflight();checkCancel();
      const id='web-full-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),directory=path.join(root,id);await fs.mkdir(directory);
      current={id,directory,producer:FULL_PRODUCER,mode:'full-suite',workload:'all',balancers:[...BALANCERS],plan:PLAN.map(p=>({...p})),total:15,completed:0,state:'running',performanceState:'running',resourceState:'running',
        currentBalancer:null,currentWorkload:null,startedAt:new Date().toISOString(),finishedAt:null,cancelRequested:false,error:null,
        scripts:ORDER.map(workload=>({workload,script:path.relative(REPO,ready.configs[workload].script),sha256:ready.configs[workload].sha256,vus:ready.configs[workload].vus,duration:ready.configs[workload].duration})),
        environment:{k6Executable:ready.executable,k6Version:ready.k6Version,engine:ready.engine,containers:ready.containers,preflightAt:ready.checkedAt},runs:[],
        resources:{schemaVersion:2,jobId:id,workload:'all',cpuUnit:'%',memoryUnit:'MiB',measurements:[]}};
      await save();await write('k6-version.txt',ready.k6Version+'\n');progress(`RUN mới: ${directory}`);
      for(const task of PLAN){
        if(cancelled)break;
        const config=ready.configs[task.workload],summary=path.join(directory,`${task.balancer}-${task.workload}.json`);
        const row={...task,summary,startedAt:new Date().toISOString(),finishedAt:null,exitCode:null,status:'FAIL',vus:config.vus,duration:config.duration,error:null};
        current.currentBalancer=task.balancer;current.currentWorkload=task.workload;
        progress(`\n[${current.completed}/15 hoàn thành] Bắt đầu ${task.balancer} / ${task.workload} (${config.vus} VUs, ${config.duration})`);
        monitor=monitorFactory({jobId:id,balancer:task.balancer,workload:task.workload,taskId:task.balancer+'-'+task.workload});current.resources.measurements.push(monitor.data);
        try{
          checkCancel();await check(task.balancer,task.workload);checkCancel();
          if((await scriptConfig(task.workload)).sha256!==config.sha256)throw Error('Script đã thay đổi sau preflight; từ chối chạy với điều kiện khác');
          if(await fs.lstat(summary).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Summary đã tồn tại; từ chối ghi đè');
          row.arguments=argumentsFor(task.balancer,task.workload,summary,config);
          Object.assign(row,await execute(ready.executable,row.arguments,path.join(directory,`${task.balancer}-${task.workload}.log`)));
          if(!row.error && !cancelled){
            const metrics=normalize(JSON.parse((await fs.readFile(summary,'utf8')).replace(/^\uFEFF/,'')),task.workload,row.exitCode);
            row.status=metrics.status==='PASS'?'PASS':'FAIL';if(row.status!=='PASS')row.error='Kết quả k6 không đạt hoặc thiếu bằng chứng PASS';
          }
        }catch(e){row.error=e.message;}
        finally{await monitor.stop();row.resourceStatus=monitor.data.state==='complete' && monitor.data.summary.validSamples>0?'COMPLETE':'ERROR';monitor=null;}
        if(cancelled){row.status='FAIL';row.error='Đã hủy theo yêu cầu';}
        row.finishedAt=new Date().toISOString();current.runs.push(row);current.completed=current.runs.length;
        await save();progress(`[${current.completed}/15 hoàn thành] ${task.balancer}/${task.workload}: ${row.status}; tài nguyên ${row.resourceStatus}${row.error?' — '+row.error:''}`);
        const measurement=current.resources.measurements.at(-1),stats=measurement.summary;
        const display=value=>typeof value==='number' && Number.isFinite(value)?value.toFixed(3):'N/A';
        progress(`CPU avg/max: ${display(stats.cpuAverage)}/${display(stats.cpuMax)} %; RAM avg/max: ${display(stats.memoryAverageMiB)}/${display(stats.memoryMaxMiB)} MiB; valid: ${stats.validSamples}${measurement.errors.length?' — '+measurement.errors.at(-1).message:''}`);
      }
      current.performanceState=!cancelled && current.runs.length===15 && current.runs.every(r=>r.status==='PASS')?'success':'failed';
      current.resourceState=!cancelled && current.runs.length===15 && current.runs.every(r=>r.resourceStatus==='COMPLETE')?'complete':'error';
      current.resourceError=current.resourceState==='complete'?null:'FULL RUN thiếu dữ liệu tài nguyên hoàn chỉnh ở một hoặc nhiều bài; không gán CPU/RAM bằng 0.';
      current.state=current.performanceState==='success' && current.resourceState==='complete'?'success':'failed';
      current.error=cancelled?'FULL RUN đã bị hủy; giữ nguyên bài đã chạy':current.state==='failed'?'Có bài FAIL hoặc thiếu dữ liệu tài nguyên hợp lệ; xem runs.json':null;
    }catch(e){if(!current)throw e;current.state='failed';current.performanceState='failed';current.resourceState='error';current.error=e.message;}
    finally{
      try{
        if(monitor){await monitor.stop();monitor=null;}
        if(current){current.cancelRequested=cancelled;current.finishedAt=new Date().toISOString();current.currentBalancer=null;current.currentWorkload=null;
          try{await save();}finally{progress(`\nFULL RUN ${current.state}: ${current.completed}/15 — ${current.directory}`);}}
      }finally{if(lock){await lock.close();lock=null;await fs.unlink(path.join(root,'.benchmark.lock'));}busy=false;}
    }
    return current;
  }
  return {run,preflight,cancel,snapshot:()=>current?JSON.parse(JSON.stringify(current)):null};
}
if(require.main===module){
  const mode=process.argv[2];
  if(process.argv.length!==3 || !['--check','--run'].includes(mode)){console.error('Dùng PowerShell: .\\dashboard\\run-full-benchmark.ps1 [-CheckOnly]');process.exitCode=1;}
  else{
    const runner=createFullBenchmarkRunner();const cancel=()=>runner.cancel();process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
    (mode==='--check'?runner.preflight():runner.run()).then(result=>{
      if(mode==='--check')console.log('Preflight OK: 5 containers, k6, endpoints, Docker Stats. Chưa chạy benchmark.');
      else process.exitCode=result.cancelRequested?130:result.state==='success'?0:1;
    }).catch(e=>{console.error('FULL RUN: '+e.message);process.exitCode=1;}).finally(()=>{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);});
  }
}
module.exports={createFullBenchmarkRunner};
