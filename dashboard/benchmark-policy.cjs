const PINNED_RUN_ID='web-full-2026-11-15T14-13-23-595Z-106fae93';
const HISTORICAL_RUN_ID='run-20261108-214448-206-b8432507';
const OFFICIAL_LABEL='RUN chính thức · 15/15 PASS · CPU/RAM';
const OFFICIAL_PROTECTION='RUN chính thức của đồ án được bảo vệ, không thể xóa';
const protectedIds=new Set([PINNED_RUN_ID,HISTORICAL_RUN_ID,'legacy-original','legacy-v2'].map(id=>id.toLowerCase()));
const isProtectedRun=id=>typeof id==='string' && protectedIds.has(id.toLowerCase());
function protectionReason(id){return typeof id==='string' && id.toLowerCase()===PINNED_RUN_ID.toLowerCase() ? OFFICIAL_PROTECTION : 'Đợt benchmark lịch sử được bảo vệ, không thể di chuyển';}
function applyBenchmarkPolicy(data){
  const batches=data.batches.map(batch=>{
    const pinned=batch.id===PINNED_RUN_ID;
    return {...batch,pinned,isProtected:isProtectedRun(batch.id),officialLabel:pinned?OFFICIAL_LABEL:null,
      ...(isProtectedRun(batch.id)?{canTrash:false,trashReason:protectionReason(batch.id)}:{})};
  });
  batches.sort((a,b)=>Number(b.pinned)-Number(a.pinned) || Number(b.complete)-Number(a.complete) || b.id.localeCompare(a.id));
  return {...data,batches,defaultBatchId:batches.find(b=>b.pinned)?.id || batches.find(b=>b.id===HISTORICAL_RUN_ID)?.id || batches[0]?.id || null};
}
module.exports={PINNED_RUN_ID,HISTORICAL_RUN_ID,OFFICIAL_LABEL,OFFICIAL_PROTECTION,isProtectedRun,protectionReason,applyBenchmarkPolicy};
