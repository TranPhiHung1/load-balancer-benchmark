import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
const errors = new Rate('workload_errors');
export const options = {
  vus: 10, duration: '30s', insecureSkipTLSVerify: true,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
  thresholds: { checks: ['rate==1'], workload_errors: ['rate==0'], http_req_failed: ['rate==0'] },
};
export default function () {
  const res = http.get(`${__ENV.BASE_URL || 'https://localhost:8440'}/api`);
  const ok = check(res, {
    'HTTP 200': r => r.status === 200,
    'actual HTTP/2': r => r.proto === 'HTTP/2.0',
    'REST response unchanged': r => {
      try { const b = r.json(); return (b.port === 3001 && b.message === 'Hello from Backend 1') || (b.port === 3002 && b.message === 'Hello from Backend 2'); } catch (_) { return false; }
    },
  });
  errors.add(!ok);
}
