const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
if (!dir) throw new Error('Usage: node tools/summarize.cjs benchmark/results/run-...');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const parsed = read(path.join(dir, 'runs.json'));
const runs = Array.isArray(parsed) ? parsed : [parsed];
const lines = ['# Kết quả chạy thực tế', '', 'Số liệu chỉ thuộc lần chạy trong thư mục này. FAIL không được dùng để xếp hạng hiệu năng.', '', '| LB | Workload | Trạng thái | Requests | RPS | Avg ms | p90 ms | p95 ms | Error rate |', '|---|---|---|---:|---:|---:|---:|---:|---:|'];
const format = n => typeof n === 'number' ? n.toFixed(3) : 'N/A';
for (const run of runs) {
  if (!fs.existsSync(run.summary)) { lines.push(`| ${run.balancer} | ${run.workload} | FAIL (no summary) | | | | | | |`); continue; }
  const data = read(run.summary).metrics;
  const metric = name => { const m = data[name] || {}; return m.values || m; };
  const count = metric(run.workload === 'grpc' ? 'unary_requests' : 'http_reqs');
  const duration = metric(run.workload === 'grpc' ? 'grpc_req_duration' : 'http_req_duration');
  const checks = metric('checks');
  const errorMetric = metric(run.workload === 'grpc' || run.workload === 'http2' ? 'workload_errors' : 'http_req_failed');
  const rate = errorMetric.value ?? errorMetric.rate;
  const failed = run.exitCode !== 0 || (checks.fails || 0) > 0 || rate > 0 || !(count.count > 0);
  lines.push(`| ${run.balancer} | ${run.workload} | ${failed ? 'FAIL' : 'PASS'} | ${count.count ?? 'N/A'} | ${format(count.rate)} | ${format(duration.avg)} | ${format(duration['p(90)'])} | ${format(duration['p(95)'])} | ${format(rate)} |`);
}
lines.push('', 'gRPC latency là grpc_req_duration; lỗi kết nối được tính vào workload_errors và unary_requests nhưng có thể không có mẫu latency.', 'Không so sánh trực tiếp HTTP/2 REST và gRPC: payload và đường xử lý khác nhau. RPS là throughput workload thực tế, bao gồm các lần thử thất bại.', 'Keep-Alive cũ có sleep 50 ms; hai workload mới không có sleep. Chạy tuần tự, không có warm-up tách riêng; TLS handshake đầu tiên thuộc lần chạy.', 'Client, LB và backend có thể cùng máy; cần chạy lặp, đổi thứ tự LB và ghi tài nguyên trước khi rút ra kết luận Chương 4.');
fs.writeFileSync(path.join(dir, 'chapter4-results.md'), lines.join('\n'), { flag: 'wx' });
