import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = { vus: 10, duration: '30s', thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] } };
export default function () {
  const response=http.post(`${__ENV.API_URL||'http://localhost:4000'}/v1/events`, JSON.stringify({ type:'load.test', data:{iteration:__ITER,vu:__VU} }), {headers:{'Content-Type':'application/json',Authorization:`Bearer ${__ENV.API_KEY}`}});
  check(response, {'accepted': r=>r.status===202}); sleep(1.1);
}
