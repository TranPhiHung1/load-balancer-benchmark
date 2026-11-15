const fs = require('node:fs/promises');
const path = require('node:path');
const { BALANCERS, WORKLOADS } = require('./results.cjs');
const {validFullMetadata}=require('./full-run-schema.cjs');
const {HISTORICAL_RUN_ID,isProtectedRun,protectionReason}=require('./benchmark-policy.cjs');
const REPO = path.resolve(__dirname,'..');
const OFFICIAL = HISTORICAL_RUN_ID;
const PRODUCER = 'lb-benchmark-dashboard';
const SCRIPTS = {rest:'rest-api.js','keepalive-on':'keep-alive.js','keepalive-off':'keep-alive.js',http2:'http2.js',grpc:'grpc-unary.js'};
const error = (message,status=403) => Object.assign(new Error(message),{status});
const same = (a,b) => process.platform === 'win32' ? a.toLowerCase()===b.toLowerCase() : a===b;
const inside = (root,file) => { const rel=path.relative(root,file); return !!rel && !rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel); };
function validateId(id) {
  if(typeof id!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id)) throw error('ID đợt kiểm thử không hợp lệ',400);
  if(isProtectedRun(id)) throw error(protectionReason(id));
}
async function realDirectory(dir) {
  const stat=await fs.lstat(dir);
  if(stat.isSymbolicLink() || !stat.isDirectory() || !same(await fs.realpath(dir),path.resolve(dir))) throw error('Từ chối thư mục symlink/junction hoặc đường dẫn ngoài vùng cho phép');
  return stat;
}
async function exists(file) { try { await fs.lstat(file);return true; } catch(e) { if(e.code==='ENOENT')return false;throw e; } }
function createResultStorage(options={}) {
  const root=path.resolve(options.root || path.join(__dirname,'results'));
  const trash=path.resolve(options.trash || path.join(__dirname,'trash'));
  const active=options.active || (()=>false);
  if(same(root,trash) || inside(root,trash) || inside(trash,root)) throw error('Thùng rác phải tách riêng thư mục kết quả');
  async function tree(dir) {
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name),stat=await fs.lstat(file);
      if(stat.isSymbolicLink() || !inside(dir,await fs.realpath(file))) throw error('Đợt chứa symlink/junction; không được phép thao tác');
      if(entry.name.endsWith('.tmp')) throw error('Đợt còn file đang ghi, không thể di chuyển',409);
      if(stat.isDirectory()) await tree(file);
      else if(!stat.isFile()) throw error('Đợt chứa loại file không được hỗ trợ');
    }
  }
  async function inspect(base,id) {
    validateId(id); await realDirectory(base);
    const dir=path.join(base,id); await realDirectory(dir);
    if(!inside(await fs.realpath(base),await fs.realpath(dir))) throw error('Đường dẫn nằm ngoài vùng cho phép');
    const metadataFile=path.join(dir,'metadata.json');
    const stat=await fs.lstat(metadataFile);
    if(!stat.isFile() || stat.isSymbolicLink()) throw error('Metadata không hợp lệ');
    let meta;
    try { meta=JSON.parse((await fs.readFile(metadataFile,'utf8')).replace(/^\uFEFF/,'')); }
    catch { throw error('Không xác minh được nguồn dữ liệu từ metadata'); }
    const original=path.join(root,id);
    const full=validFullMetadata(meta,REPO);
    // Accept older Dashboard metadata without a producer marker only when all adapter fields match.
    if(!meta || meta.id!==id || typeof meta.directory!=='string' || !same(path.resolve(meta.directory),original) || (!full && (
      (meta.producer!==undefined && meta.producer!==PRODUCER) || !WORKLOADS.includes(meta.workload) ||
      !Array.isArray(meta.balancers) || !meta.balancers.length || !meta.balancers.every(b=>BALANCERS.includes(b)) ||
      typeof meta.script!=='string' || !same(path.resolve(REPO,meta.script),path.join(REPO,'benchmark',SCRIPTS[meta.workload])) ||
      !/^[a-f0-9]{64}$/i.test(meta.scriptSha256 || '') || !Number.isFinite(meta.vus) || meta.vus<=0 ||
      !/^\d+s$/.test(meta.duration || '') || !Array.isArray(meta.runs) || meta.total!==meta.balancers.length ||
      meta.completed!==meta.runs.length || meta.completed>meta.total))) throw error('Không xác minh được đợt này do Dashboard tạo tại dashboard/results');
    if(!['success','failed'].includes(meta.state) || !Number.isFinite(Date.parse(meta.finishedAt)) ||
      !Number.isFinite(Date.parse(meta.startedAt)) || meta.currentBalancer!==null ||
      meta.runs.some(r=>!r || !meta.balancers.includes(r.balancer) || (!full && r.workload!==meta.workload) || !Number.isFinite(Date.parse(r.finishedAt)))) throw error('Đợt benchmark chưa hoàn tất hoặc đang ghi dữ liệu',409);
    await tree(dir);
    return {dir,meta};
  }
  async function blocked() { return !!active() || await exists(path.join(root,'.benchmark.lock')); }
  async function permission(id) {
    try {
      if(isProtectedRun(id))return {canTrash:false,trashReason:protectionReason(id)};
      if(await blocked()) return {canTrash:false,trashReason:'Benchmark đang chạy hoặc còn khóa ghi dữ liệu'};
      await inspect(root,id);return {canTrash:true,trashReason:'Chuyển vào thùng rác, có thể khôi phục'};
    } catch(e) {return {canTrash:false,trashReason:e.status ? e.message : 'Không xác minh được nguồn hoặc trạng thái đợt'};}
  }
  async function annotate(data) {
    return {...data,batches:await Promise.all(data.batches.map(async batch=>({...batch,...(batch.origin==='dashboard' ? await permission(batch.id) : {canTrash:false,trashReason:'Kết quả lịch sử được bảo vệ'})})))};
  }
  async function exclusive(action) {
    if(active()) throw error('Benchmark chưa hoàn tất; vui lòng chờ',409);
    await realDirectory(root);
    let handle;
    try { handle=await fs.open(path.join(root,'.benchmark.lock'),'wx'); }
    catch(e) { if(e.code==='EEXIST')throw error('Benchmark hoặc thao tác dữ liệu khác đang giữ khóa',409);throw e; }
    try { await handle.writeFile(JSON.stringify({pid:process.pid,operation:'result-maintenance'}));return await action(); }
    finally { await handle.close();await fs.unlink(path.join(root,'.benchmark.lock')); }
  }
  async function move(id,restore=false) {
    validateId(id);
    try {
      return await exclusive(async()=>{
        const from=restore ? trash : root, to=restore ? root : trash;
        const checked=await inspect(from,id);
        if(!await exists(to)) { await realDirectory(path.dirname(to));await fs.mkdir(to); }
        await realDirectory(to);
        if(await exists(path.join(to,id)))throw error('Đã có thư mục cùng ID ở đích; không ghi đè',409);
        // Recheck after awaits. All Dashboard writers/movers share the root lock.
        await realDirectory(from); await realDirectory(checked.dir); await realDirectory(to);
        if(active())throw error('Benchmark đang kiểm tra điều kiện hoặc chưa hoàn tất',409);
        await fs.rename(checked.dir,path.join(to,id));
        return {id,action:restore?'restored':'trashed'};
      });
    } catch(e) { if(e.code==='ENOENT')throw error('Không tìm thấy đợt hoặc metadata hợp lệ',404);throw e; }
  }
  async function listTrash() {
    if(!await exists(trash))return {batches:[]};
    await realDirectory(trash);
    const locked=await blocked(),batches=[];
    for(const entry of await fs.readdir(trash,{withFileTypes:true})) {
      if(!entry.isDirectory() || entry.isSymbolicLink())continue;
      try {const {meta}=await inspect(trash,entry.name);batches.push({id:entry.name,state:meta.state,canRestore:!locked && !await exists(path.join(root,entry.name))});}
      catch { /* unverified directories are never offered for operations */ }
    }
    return {batches:batches.sort((a,b)=>b.id.localeCompare(a.id))};
  }
  return {permission,annotate,listTrash,trash:id=>move(id),restore:id=>move(id,true)};
}
module.exports={createResultStorage,validateId,OFFICIAL,PRODUCER};
