
import http from 'k6/http';
import { check, sleep } from 'k6';

const keepAliveEnabled = __ENV.KEEP_ALIVE !== 'off';

export const options = {
  vus: 10,
  duration: '30s',
  noConnectionReuse: !keepAliveEnabled,
  noVUConnectionReuse: false,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function () {
  const response = http.get(`${BASE_URL}/api`);

  check(response, {
    'HTTP status 200': (r) => r.status === 200,
  });

  sleep(0.05);
}
