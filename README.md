# Load Balancer Benchmark

Đồ án: Triển khai và đánh giá Nginx, HAProxy, Envoy. Ba LB độc lập, dùng chung hai Node.js/Express backend. Bổ sung HTTP/2 REST và gRPC Unary; giữ endpoint HTTP cũ và các benchmark cũ.

| LB | HTTP cũ | HTTP/2 REST qua TLS | gRPC Unary qua TLS |
|---|---:|---:|---:|
| Nginx | 8080 | 8440 | 9440 |
| HAProxy | 8081 | 8441 | 9441 |
| Envoy | 8082 | 8442 | 9442 |

Xem [hướng dẫn triển khai và benchmark PowerShell](docs/http2-grpc.md), [trạng thái kiểm thử thực tế](docs/verification.md) và [bản tổng hợp Chương 4](docs/chapter4-results.md).

Chuẩn bị Node.js/npm, Docker Compose và k6 trong PATH. Không có bước cài đặt công cụ toàn hệ thống tự động.

```powershell
npm.cmd ci --prefix tools
npm.cmd ci --prefix backend/backend-1
npm.cmd ci --prefix backend/backend-2
node tools/generate-certs.cjs
.\tools\validate.ps1
.\benchmark\run.ps1 -Suite all
```

`validate.ps1` build/start Compose, kiểm tra binary/config từng LB và kiểm tra giao thức/phân phối. Runner tạo thư mục kết quả mới mỗi lần; không ghi đè kết quả cũ. Chứng chỉ/key sinh cục bộ được bỏ qua bởi Git.

Bằng chứng ngày 08/11/2026: [run-20261108-214448-206-b8432507](benchmark/results/run-20261108-214448-206-b8432507/chapter4-results.md) có 15 lượt benchmark thành công (10 VUs/30 giây): HTTP/2, gRPC Unary, REST và Keep-Alive ON/OFF qua cả ba LB. HTTP/2 kiểm tra protocol thực tế; gRPC ghi nhận cả hai backend. Kết luận dựa trên JSON/log đã lưu, không chạy lại khi lưu tiến độ. Chưa có log riêng của binary syntax validation hoặc verifier ALPN xác minh chứng chỉ trong thư mục run; không suy diễn các bước đó đã PASS.
