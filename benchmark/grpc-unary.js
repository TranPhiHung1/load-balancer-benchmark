import grpc from 'k6/net/grpc';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
const client = new grpc.Client();
client.load(['../backend/proto'], 'greeter.proto');
const calls = new Counter('unary_requests');
const errors = new Rate('workload_errors');
const backend1 = new Counter('backend_1_responses');
const backend2 = new Counter('backend_2_responses');
export const options = {
  vus: 10, duration: '30s', insecureSkipTLSVerify: true,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)'],
  thresholds: { checks: ['rate==1'], workload_errors: ['rate==0'], backend_1_responses: ['count>0'], backend_2_responses: ['count>0'] },
};
let connected = false;
export default function () {
  calls.add(1);
  try {
    if (!connected) {
      client.connect(__ENV.GRPC_ADDR || 'localhost:9440', { plaintext: __ENV.PLAINTEXT === 'true', timeout: '5s' });
      connected = true;
    }
    const res = client.invoke('benchmark.GreeterService/SayHello', { name: 'benchmark' }, { timeout: '5s' });
    const ok = check(res, {
      'gRPC status OK': r => r.status === grpc.StatusOK,
      'Unary payload': r => r.message && r.message.message === 'Hello benchmark' && ['backend-1', 'backend-2'].includes(r.message.backend),
    });
    errors.add(!ok);
    if (ok && res.message.backend === 'backend-1') backend1.add(1);
    if (ok && res.message.backend === 'backend-2') backend2.add(1);
  } catch (error) {
    errors.add(true);
    check(false, { 'gRPC transport successful': x => x });
    client.close();
    connected = false;
  }
}
