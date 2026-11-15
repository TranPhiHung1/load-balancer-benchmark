const path=require('node:path');
const FULL_PRODUCER='lb-benchmark-dashboard-full';
const BALANCERS=['nginx','haproxy','envoy'];
// Same order as benchmark/run.ps1 -Suite all -Balancer all.
const ORDER=['http2','grpc','rest','keepalive-on','keepalive-off'];
const PLAN=Object.freeze(BALANCERS.flatMap(balancer=>ORDER.map(workload=>Object.freeze({balancer,workload}))));
const SCRIPTS={rest:'rest-api.js','keepalive-on':'keep-alive.js','keepalive-off':'keep-alive.js',http2:'http2.js',grpc:'grpc-unary.js'};
const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
function validFullMetadata(meta,repo){
  return meta?.producer===FULL_PRODUCER && meta.mode==='full-suite' && meta.workload==='all' && meta.total===15 &&
    Array.isArray(meta.balancers) && JSON.stringify(meta.balancers)===JSON.stringify(BALANCERS) &&
    Array.isArray(meta.plan) && meta.plan.length===15 && meta.plan.every((p,i)=>p?.balancer===PLAN[i].balancer && p?.workload===PLAN[i].workload) &&
    Array.isArray(meta.scripts) && meta.scripts.length===5 && ORDER.every(workload=>meta.scripts.some(s=>s?.workload===workload && typeof s.script==='string' && same(path.resolve(repo,s.script),path.join(repo,'benchmark',SCRIPTS[workload])) && /^[a-f0-9]{64}$/i.test(s.sha256 || '') && s.vus>0 && Number.isFinite(s.vus) && /^\d+s$/.test(s.duration || ''))) &&
    Array.isArray(meta.runs) && meta.completed===meta.runs.length && meta.completed<=15 &&
    new Set(meta.runs.map(r=>r?.balancer+'/'+r?.workload)).size===meta.runs.length &&
    meta.runs.every(r=>PLAN.some(p=>r?.balancer===p.balancer && r?.workload===p.workload));
}
module.exports={FULL_PRODUCER,BALANCERS,ORDER,PLAN,validFullMetadata};
