# Trạng thái xác minh ngày 08/11/2026

## Kết luận hiện tại

Đã triển khai mã và cấu hình cho HTTP/2 REST và gRPC Unary trên ba LB. Bằng chứng mới tại `benchmark/results/run-20261108-214448-206-b8432507/` xác nhận **15/15 lượt benchmark qua LB thành công**, gồm HTTP/2, gRPC, REST và Keep-Alive ON/OFF trên Nginx, HAProxy, Envoy, mỗi lượt 10 VUs/30 giây. Đã đọc `runs.json`, 15 summary JSON, bảng kết quả, console log và snapshot Compose/image; không chạy lại benchmark khi lưu tiến độ.

HTTP/2 có checks status, protocol `HTTP/2.0` và JSON đều thành công. gRPC có checks status/payload thành công, workload_errors = 0 và response từ cả hai backend: Nginx 42146/42145, HAProxy 35518/35518, Envoy 36424/36428. Snapshot Compose ghi nhận cả 5 container đang chạy. Xem [bảng số liệu chính thức](chapter4-results.md).

Chưa có log riêng chứng minh `nginx -t`, `haproxy -c`, Envoy validate, binary versions hoặc verifier TLS/ALPN xác minh chứng chỉ đã chạy; không đánh dấu các bước đó PASS chỉ từ benchmark. k6 bỏ qua xác minh chứng chỉ tự ký theo cấu hình lab.

## Bảo quản tiến độ

Toàn bộ 86 file kết quả hiện có (281766 byte trước khi cập nhật tài liệu), gồm dữ liệu cũ, lượt smoke thành công/thất bại và run chính thức, được giữ nguyên và đưa vào Git sau kiểm tra nội dung. Có cả JSON, console log, snapshot Compose/image, Git HEAD/diff và bảng tổng hợp. Không có khóa riêng hoặc thông tin đăng nhập được phát hiện trong tập file lưu. Các đường dẫn Windows và image ID trong bằng chứng được giữ nguyên để bảo toàn nguồn gốc.

`certs/`, private key/keystore, `.env`, `node_modules/`, `.npm-cache/` và file tạm tiếp tục bị loại trừ. Các tài liệu Word/PowerPoint/PDF và thư mục tài liệu cá nhân theo quy tắc ignore cũ vẫn nằm nguyên trên máy, chưa đưa vào commit này. Không sửa logic benchmark/config hoặc dữ liệu kết quả trong bước lưu tiến độ.

## Các giai đoạn triển khai ban đầu (lịch sử trước run chính thức)

| Giai đoạn | Thay đổi | Lệnh/kiểm tra | Kết quả |
|---|---|---|---|
| Khảo sát | Không sửa file | Đọc Compose, 3 config LB, 2 server/package/Dockerfile, 2 benchmark, tài liệu TXT và danh sách file Git | PASS; không có README cũ hoặc AGENTS.md trong workspace |
| HTTP/2 | Compose, 3 config LB, cert generator, HTTP/2 k6/verifier | `node tools/generate-certs.cjs`, xác minh X509 bằng Node, `k6 inspect benchmark/http2.js` | PASS phần cert/khởi tạo script; binary/LB runtime NOT RUN |
| gRPC | proto, shared server, hai server/package/lock/Dockerfile, cluster/listener LB, k6/verifier | `npm.cmd install ...` cục bộ; `k6 inspect benchmark/grpc-unary.js`; `node tools/test-local.cjs` | PASS gRPC trực tiếp hai backend và k6 h2c; proxy qua LB NOT RUN |
| Benchmark | 2 script k6 mới, runner, summarizer | Hai script mặc định 10 VUs/30s; smoke gRPC trực tiếp 2 VUs/2s | Benchmark chính thức trên 3 LB NOT RUN |
| Hồi quy | Giữ nguyên 2 script cũ | REST, Keep-Alive ON/OFF mỗi backend trực tiếp, 2 VUs/2s | PASS 6 lượt; hồi quy qua 8080–8082 NOT RUN |
| Tài liệu | README, docs | YAML parse, JS check, PowerShell parser, Git diff check | PASS phần đã thực hiện; YAML parse không thay thế binary validation |

Bằng chứng lượt smoke cuối: `benchmark/results/local-2026-11-08T14-39-15-374Z/`. File `scope.txt` mô tả giới hạn; JSON và console log là dữ liệu chạy thật. Mỗi backend còn được gọi 40 Unary bằng grpc-js. k6 gRPC trực tiếp dùng `--no-thresholds` vì chỉ có một backend trên một endpoint; kiểm tra status, payload và error rate vẫn được kiểm tra bởi harness. Tắt threshold chỉ áp dụng smoke này, không áp dụng benchmark qua LB.

## Lỗi và nguyên nhân đã gặp

- `docker version`: CommandNotFoundException. Không có `docker.exe` hoặc Docker Desktop tại đường dẫn cài đặt thông thường. Chưa chạy được `compose up`, `compose ps`, `nginx -t`, `haproxy -c`, Envoy validate, TLS/ALPN qua LB hoặc benchmark LB. WSL liệt kê distro cũng trả E_ACCESSDENIED; không dùng làm đường thay thế.
- Lần tải npm đầu trong sandbox trả EACCES tới registry/cache; đã tải thành công với quyền mạng được cấp và cache cục bộ `.npm-cache`, không cài toàn hệ thống.
- Lần smoke đầu trong sandbox bị gián đoạn do môi trường thực thi. Lần thử trực tiếp trên cổng mặc định gặp gRPC ECONNREFUSED: cổng REST mặc định đã có tiến trình khác; chưa thể coi HTTP response đó là bằng chứng server mới sẵn sàng. Đã sửa harness và thêm biến cổng để dùng riêng REST 13001/13002, gRPC 15051/15052. Lượt chạy lại PASS; không dừng hoặc sửa tiến trình cũ.
- `npm audit` backend báo body-parser (high), proxy-addr (critical), qs (moderate) trong cây dependency Express. Không tự nâng Express trong thay đổi giao thức. Công cụ `tools` audit 0 vulnerabilities tại lần cài. Cần xử lý dependency Express trước khi triển khai ngoài môi trường lab.

## Lệnh tái lập khi cần (không chạy lại trong bước lưu tiến độ)

```powershell
.\tools\validate.ps1
.\benchmark\run.ps1 -Suite http2
.\benchmark\run.ps1 -Suite grpc
.\benchmark\run.ps1 -Suite regression
```

Lưu version/digest thực tế, log, kết quả ALPN, phân phối cả hai backend và `chapter4-results.md` theo từng run. Nếu FAIL phải sửa nguyên nhân và chạy lại; không lấy dữ liệu smoke trực tiếp để xếp hạng Nginx/HAProxy/Envoy.

Ở lần triển khai ban đầu, `git diff --exit-code -- benchmark/rest-api.js benchmark/keep-alive.js benchmark/results` trả 0: script và dữ liệu cũ được giữ nguyên. Bước lưu tiến độ hiện tại được người dùng cho phép commit và push; không sửa lịch sử Git.
