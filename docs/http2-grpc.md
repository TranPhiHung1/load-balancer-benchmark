# HTTP/2 REST và gRPC Unary

## Kiến trúc

HTTP cũ: client → `8080/8081/8082` → LB cổng 80 → Express `backend-1:3001`, `backend-2:3002`.

HTTP/2 REST: client → TLS/ALPN `h2` → `8440/8441/8442` → LB cổng 443 → HTTP/1.1 → Express `/api`. Đây là HTTP/2 ở chặng client–LB, không phải HTTP/2 end-to-end. JSON vẫn có đúng `message` và `port` như trước.

gRPC: client → TLS/HTTP/2 → `9440/9441/9442` → LB cổng 9443 → HTTP/2 cleartext (h2c prior knowledge) → `backend-1:50051`, `backend-2:50051`. Hai container dùng cùng cổng nội bộ không xung đột. Cổng gRPC backend không publish ra host.

Service `benchmark.GreeterService/SayHello` trong `backend/proto/greeter.proto` nhận `name`, trả `message` và `backend`. HTTP GET `/api` là workload REST, không phải gRPC. Express và gRPC cùng chạy trong mỗi backend. `REST_PORT`/`GRPC_PORT` cho phép smoke test cục bộ bằng cổng khác; mặc định Compose không thay đổi. Trường `port` của REST vẫn nhận diện backend 3001/3002.

## Khả năng tương thích

- Nginx dùng `http2 on` (cần Nginx ≥1.25.1 cùng module HTTP/2 và SSL) và `grpc_pass grpc://...` cho upstream h2c. Nginx `latest` chưa được xác minh binary tại môi trường thực hiện. [HTTP/2 module](https://nginx.org/en/docs/http/ngx_http_v2_module.html), [gRPC module](https://nginx.org/en/docs/http/ngx_http_grpc_module.html).
- HAProxy dùng TLS `alpn h2` và `server ... proto h2` cho gRPC. Tài liệu mô tả hỗ trợ proxy gRPC từ HAProxy 2.0. [Tài liệu chính thức](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/protocol-support/grpc/).
- Envoy dùng DownstreamTlsContext và ALPN, cluster gRPC cấu hình explicit HTTP/2; cluster REST vẫn dùng mặc định HTTP/1.1. [Upstream HTTP protocol options](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/upstreams/http/v3/http_protocol_options.proto).
- k6 hiện có trong phiên làm việc: `v2.2.0`, module `k6/net/grpc` load thành công. [gRPC connect](https://grafana.com/docs/k6/latest/javascript-api/k6-net-grpc/client/client-connect/).

Giữ nguyên image tag hiện tại (`nginx:latest`, `haproxy:latest`, `envoyproxy/envoy:v1.39-latest`). Run `run-20261108-214448-206-b8432507` đã có snapshot container hoạt động và image ID, cùng benchmark thành công. Chưa có output binary version hoặc digest đầy đủ trong tập bằng chứng; không coi tag là bằng chứng version cụ thể. Khi chuẩn bị thí nghiệm tiếp theo, lưu output `nginx -V`, `haproxy -vv`, `envoy --version`, image ID/digest; nên cố định digest đã xác minh để tái lập thí nghiệm.

## Chuẩn bị và khởi động bằng Windows PowerShell

Chạy từ thư mục gốc repository. Cần Node.js/npm, Docker Desktop với Linux containers/Compose và k6 đã có trong PATH.

```powershell
npm.cmd ci --prefix tools
npm.cmd ci --prefix backend/backend-1
npm.cmd ci --prefix backend/backend-2
node tools/generate-certs.cjs
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Build context backend đã chuyển sang `./backend` để COPY service dùng chung và proto; Dockerfile tương ứng vẫn ở `backend/backend-1` và `backend/backend-2`. `.dockerignore` loại node_modules host; image dùng `npm ci --omit=dev` theo lockfile.

Chứng chỉ tự ký RSA/SHA256 có SAN `localhost`, `127.0.0.1`, `::1`, hạn 365 ngày. File trong `certs/` gồm `.crt`, `.key`, `.pem` (cert+key cho HAProxy), mount read-only. Công cụ giữ nguyên file có sẵn, từ chối bộ file thiếu; khi chứng chỉ hết hạn, tự di chuyển bộ cũ ra ngoài rồi tạo lại. Không thêm vào trust store Windows. Chỉ dùng key này trong lab localhost.

## Kiểm tra cấu hình và giao thức

```powershell
# Gộp build/start, kiểm tra version, syntax và smoke test:
.\tools\validate.ps1

# Hoặc kiểm tra riêng từng binary:
docker compose exec -T nginx nginx -V
docker compose exec -T nginx nginx -t
docker compose exec -T haproxy haproxy -vv
docker compose exec -T haproxy haproxy -c -f /usr/local/etc/haproxy/haproxy.cfg
docker compose exec -T envoy envoy --version
docker compose exec -T envoy envoy --mode validate -c /etc/envoy/envoy.yaml

curl.exe http://localhost:8080/api
curl.exe http://localhost:8081/api
curl.exe http://localhost:8082/api
node tools/verify.cjs --http-only
node tools/verify.cjs --grpc-only
node tools/verify.cjs
```

Verifier HTTP/2 dùng Node http2, tin cậy đúng chứng chỉ sinh cục bộ, kiểm tra ALPN thực tế bằng `session.alpnProtocol === 'h2'`, status và JSON. HTTP 200 một mình không đủ để kết luận. k6 cũng kiểm tra `res.proto === 'HTTP/2.0'` mỗi request; TLS tự ký được bỏ qua xác minh trong benchmark để chạy lab, còn verifier xác minh chứng chỉ.

Verifier gRPC gọi service thật 40 lần qua một channel TLS/HTTP/2 trên mỗi LB và yêu cầu thấy cả `backend-1`, `backend-2`. Kiểm tra này phân biệt phân phối từng RPC và phân phối từng kết nối; không kỳ vọng các response xen kẽ tuyệt đối. Nginx dùng round robin upstream mặc định, HAProxy và Envoy dùng roundrobin/ROUND_ROBIN. Health check mới của HAProxy/Envoy là TCP, không phải gRPC health service; Nginx dùng cơ chế lỗi upstream thụ động. Không diễn giải chúng là cùng một chính sách failover.

Nếu kiểm tra thất bại:

```powershell
docker compose logs --tail 100 nginx haproxy envoy backend-1 backend-2
docker compose ps -a
```

Lỗi bind thường do cổng bị chiếm. Lỗi cert thường do chưa chạy generator hoặc mount sai. Nginx báo unknown directive `http2` cần kiểm tra version/module, không xóa kiểm tra protocol để làm bài thử PASS. Lỗi gRPC UNAVAILABLE cần kiểm tra backend cổng 50051 và upstream `h2` của LB. Chỉ kết luận sau khi chạy lại thành công.

## Benchmark riêng từng LB

Hai workload mới mặc định 10 VUs, 30 giây, không sleep và tái sử dụng kết nối. Cùng script và payload cho cả ba LB trong mỗi workload. Runner chạy tuần tự và lưu summary JSON, console log, exit code, version k6, Git HEAD/diff, Compose image/ps nếu có Docker. Mỗi lần chạy có timestamp + ID ngẫu nhiên riêng trong `benchmark/results/run-*`.

```powershell
.\benchmark\run.ps1 -Suite http2 -Balancer nginx
.\benchmark\run.ps1 -Suite http2 -Balancer haproxy
.\benchmark\run.ps1 -Suite http2 -Balancer envoy
.\benchmark\run.ps1 -Suite grpc -Balancer nginx
.\benchmark\run.ps1 -Suite grpc -Balancer haproxy
.\benchmark\run.ps1 -Suite grpc -Balancer envoy
# Hồi quy script cũ: REST và Keep-Alive ON/OFF trên cả ba LB
.\benchmark\run.ps1 -Suite regression
# Chạy toàn bộ:
.\benchmark\run.ps1 -Suite all
```

Có thể gọi trực tiếp; chọn tên export mới mỗi lần, vì k6 tự nó không bảo vệ ghi đè:

```powershell
$runId = [guid]::NewGuid().ToString('N')
k6 run -e BASE_URL=https://localhost:8440 --summary-export="benchmark/results/nginx-http2-$runId.json" benchmark/http2.js
k6 run -e GRPC_ADDR=localhost:9440 --summary-export="benchmark/results/nginx-grpc-$runId.json" benchmark/grpc-unary.js
```

HAProxy thay cổng thành 8441/9441; Envoy thành 8442/9442. gRPC dùng TLS mặc định; không đặt `PLAINTEXT=true` khi đi qua các listener này. Benchmark mặc định yêu cầu có response từ cả hai backend. Không tắt threshold cho bài đo chính thức.

Trong mỗi thư mục run, `chapter4-results.md` tổng hợp requests, RPS, average, p90, p95 và tỷ lệ lỗi (0–1); kiểm tra `runs.json` và console log khi có FAIL. `workload_errors` HTTP/2 bao gồm status, protocol và payload sai; với gRPC bao gồm transport, status, payload. gRPC latency lấy `grpc_req_duration`; lỗi connect không có mẫu RPC latency nhưng vẫn tính vào số lần thử và tỷ lệ lỗi. Ngay cả khi exit code 0, bộ tổng hợp vẫn đánh FAIL nếu checks hoặc error rate thất bại.

## Giới hạn thí nghiệm

HTTP/2 REST và gRPC có payload/serialization/đường xử lý khác nhau, không so trực tiếp RPS để kết luận giao thức nào tốt hơn. Chỉ so sánh ba LB trong cùng workload. Hai workload mới không có sleep; Keep-Alive cũ có sleep 50 ms. Bài đo gồm kết nối/TLS ban đầu, chưa có warm-up riêng. Các LB, backend và client có thể cùng máy; không có CPU/memory limit, nên tài nguyên host ảnh hưởng kết quả. Nên chạy nhiều vòng, đổi thứ tự LB, ghi `docker stats --no-stream`, trạng thái host và version/digest. p90/p95 ở một lần chạy ngắn chưa đủ cho kết luận tổng quát.

## File thay đổi

- `docker-compose.yml`, ba cấu hình LB: thêm listener, mount cert, upstream gRPC, giữ HTTP cũ.
- Hai Dockerfile/package/lock/server: thêm dependency gRPC và startup song song Express.
- `backend/proto/greeter.proto`, `backend/shared/grpc-server.js`, `backend/.dockerignore`.
- `benchmark/http2.js`, `benchmark/grpc-unary.js`, `benchmark/run.ps1`.
- `tools/`: dependency cục bộ, generator cert, generator phần Envoy mới, verifier, smoke test trực tiếp, validator Compose/LB, tổng hợp kết quả.
- `.gitignore`: cert và npm cache; `README.md`, `docs/`: hướng dẫn và trạng thái thực tế.

Không sửa hai script benchmark cũ hoặc các kết quả cũ. Không có commit/push.
