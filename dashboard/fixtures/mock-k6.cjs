// Test process only. Copies an existing historical summary; NEVER generates a measurement.
// Used only with temporary dashboard/test-job-* roots, never dashboard/results.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const output = args.find(a=>a.startsWith('--summary-export='))?.slice('--summary-export='.length);
if (!output || !path.resolve(output).split(path.sep).some(p=>p.startsWith('test-job-'))) throw new Error('Mock k6 only writes to a temporary test-job directory');
console.log('TEST FIXTURE — NOT A LIVE BENCHMARK');
console.error('fixture stderr');
setTimeout(()=>{
  if(process.env.DASHBOARD_FIXTURE_MODE==='invalid') fs.writeFileSync(output,'{invalid json',{flag:'wx'});
  else {
    const name=path.basename(output);
    fs.copyFileSync(path.resolve(__dirname,'../../benchmark/results/run-20261108-214448-206-b8432507',name),output,fs.constants.COPYFILE_EXCL);
  }
  process.exit(process.env.DASHBOARD_FIXTURE_MODE==='exit-fail' ? 99 : 0);
},Number(process.env.DASHBOARD_FIXTURE_DELAY || 30));
