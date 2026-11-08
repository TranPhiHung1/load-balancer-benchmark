# Lệnh trình diễn đồ án trên Windows PowerShell

Đồ án: **Triển khai và đánh giá các hệ thống Load Balancer (Nginx, HAProxy, Envoy)**.

Tài liệu đối chiếu mã nguồn ngày 09/11/2026. Chạy từng khối theo thứ tự trong cùng cửa sổ **Windows PowerShell**, từ thư mục gốc dự án. Các lệnh thay đổi container và chạy benchmark bên dưới là hướng dẫn để sinh viên tự thực hiện khi demo; không được thực thi trong lúc tạo tài liệu này.

**Trạng thái xác minh:** đường dẫn, cổng, service, tham số script đã đối chiếu tĩnh. Các lệnh demo tương tác, khởi động/dừng/recovery và verifier TLS/ALPN: **CHƯA XÁC MINH trực tiếp trong lần soạn này**. Bằng chứng cũ tại [run-20261108-214448-206-b8432507](../benchmark/results/run-20261108-214448-206-b8432507/chapter4-results.md) có 15 lượt benchmark thành công; không đồng nghĩa mọi thao tác demo dưới đây đã được thử. Xem thêm [trạng thái xác minh](verification.md).

## Bảng cổng và tên service

| Hệ thống | Service Compose | Tên container | REST HTTP | REST HTTP/2 TLS | gRPC TLS |
|---|---|---|---|---|---|
| Nginx | nginx | nginx-lb | 8080 | 8440 | 9440 |
| HAProxy | haproxy | haproxy-lb | 8081 | 8441 | 9441 |
| Envoy | envoy | envoy-lb | 8082 | 8442 | 9442 |
| Backend 1 | backend-1 | backend-1 | 3001 | — | 50051 nội bộ |
| Backend 2 | backend-2 | backend-2 | 3002 | — | 50051 nội bộ |

Lệnh `docker compose` dùng **tên service** (`nginx`, không phải `nginx-lb`). Trong container LB, các listener là 80, 443, 9443. Cổng bên ngoài khác nhau để ba LB chạy độc lập, cùng dùng hai backend.

## Phần A — Khởi động hệ thống

### A1. Chuẩn bị terminal và kiểm tra Docker Desktop

Mở Docker Desktop bằng giao diện Windows, chọn Linux containers và đợi engine sẵn sàng. Không mở thêm hai backend bằng `node server.js` trên host vì có thể chiếm cổng 3001/3002.

```powershell
Set-Location -LiteralPath 'D:\6. ĐỒ ÁN CHUYÊN NGÀNH'
Get-Command docker, node, npm.cmd, k6, curl.exe -ErrorAction Stop
docker version
docker info
docker compose version
node --version
k6 version
```

`docker version` cần có cả Client và Server; `docker info` phải truy cập được engine. Nếu không tìm thấy `docker`, kiểm tra cài đặt/PATH và mở terminal mới. Nếu chỉ có Client hoặc báo lỗi kết nối engine, xử lý Docker Desktop trước khi tiếp tục. Không tự cài công cụ toàn hệ thống trong buổi demo.

### A2. Dependency và chứng chỉ localhost

Chỉ chạy `npm.cmd ci --prefix tools` lúc chuẩn bị nếu dependency công cụ chưa có; cần mạng và có thể mất thời gian. Backend được cài dependency bên trong Dockerfile, không cần chạy server host.

```powershell
# Chuẩn bị trước buổi demo nếu tools/node_modules chưa có:
npm.cmd ci --prefix tools

# Tạo chứng chỉ nếu chưa có; giữ nguyên bộ file đã có:
node .\tools\generate-certs.cjs
if ($LASTEXITCODE -ne 0) { throw 'Chua chuan bi duoc chung chi localhost' }
Test-Path .\certs\localhost.crt
Test-Path .\certs\localhost.key
Test-Path .\certs\localhost.pem
```

Ba kết quả `Test-Path` cần là `True`. Generator từ chối bộ chứng chỉ thiếu file; không xóa hoặc ghi đè key để xử lý vội. Chứng chỉ có thời hạn, có thể cần chuẩn bị lại trước buổi demo. Không hiển thị nội dung `.key`/`.pem` lên màn hình hoặc đưa lên GitHub.

### A3. Khởi động và kiểm tra 5 container

```powershell
docker compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose khong hop le' }
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Khoi dong that bai; kiem tra log' }
docker compose ps -a
```

Kiểm tra đủ `backend-1`, `backend-2`, `nginx-lb`, `haproxy-lb`, `envoy-lb` ở trạng thái chạy. `Up` chỉ chứng minh tiến trình đang chạy, chưa chứng minh API/gRPC sẵn sàng. Nếu image đã build sẵn và mã không thay đổi, có thể dùng `docker compose up -d` để khởi động nhanh hơn, tránh build trong buổi trình diễn.

```powershell
curl.exe --silent --show-error --max-time 10 -i http://localhost:8080/api
curl.exe --silent --show-error --max-time 10 -i http://localhost:8081/api
curl.exe --silent --show-error --max-time 10 -i http://localhost:8082/api
```

Kỳ vọng HTTP 200 và JSON `message: Hello from Backend 1`, `port: 3001` hoặc `message: Hello from Backend 2`, `port: 3002`. Nếu lỗi, đọc log trước khi chuyển phần:

```powershell
docker compose logs --tail 80 backend-1 backend-2 nginx haproxy envoy
```

## Phần B — Demo Round Robin

Định nghĩa hàm dưới đây một lần. Mỗi vòng gọi một tiến trình `curl.exe` riêng, tạo request HTTP/1.1 độc lập. Hàm chỉ đọc response, không ghi file; không dùng `--fail` để vẫn quan sát được body/status của HTTP 4xx/5xx.

```powershell
function Show-DemoRest {
    param([string]$Balancer, [int]$Port, [int]$Count = 10)
    for ($requestNumber = 1; $requestNumber -le $Count; $requestNumber++) {
        $responseLines = @(& curl.exe --http1.1 --silent --show-error `
            --connect-timeout 2 --max-time 8 `
            --write-out "`n%{http_code}" "http://localhost:$Port/api")
        $curlExit = $LASTEXITCODE
        $httpStatus = 'NO_RESPONSE'
        $backend = 'UNKNOWN'
        $message = ''
        if ($responseLines.Count -gt 0) {
            $httpStatus = [string]$responseLines[-1]
            $body = ($responseLines | Select-Object -SkipLast 1) -join "`n"
            try {
                $payload = $body | ConvertFrom-Json -ErrorAction Stop
                if ($payload.port -eq 3001) { $backend = 'backend-1' }
                if ($payload.port -eq 3002) { $backend = 'backend-2' }
                $message = $payload.message
            } catch { $message = $body }
        }
        [pscustomobject]@{
            LB = $Balancer; Request = $requestNumber; HTTP = $httpStatus
            Backend = $backend; Message = $message; CurlExit = $curlExit
        }
    }
}

Show-DemoRest -Balancer nginx -Port 8080 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer haproxy -Port 8081 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer envoy -Port 8082 -Count 10 | Format-Table -AutoSize
```

Quan sát cột `Backend`/`Message` để nhận biết server xử lý; `HTTP=200`, `CurlExit=0` mới là request thành công. `000` hoặc CurlExit khác 0 là lỗi kết nối/timeout, không phải response thành công của backend.

**Cấu hình:** Nginx upstream không đặt thuật toán khác nên dùng round robin mặc định; HAProxy có `balance roundrobin`; Envoy có `lb_policy: ROUND_ROBIN`. **Quan sát:** cả hai backend có xuất hiện trong mẫu hay không, số request từng backend bao nhiêu. Không cam kết 10 request luôn chia chính xác 5/5 hoặc xen kẽ tuyệt đối: trạng thái worker/kết nối, health check, retry và request khác có thể ảnh hưởng. Mẫu 10 request là minh họa, chưa phải đánh giá thống kê thuật toán.

## Phần C — Demo HTTP/2

### C1. Kiểm tra giao thức thực tế và TLS/ALPN

```powershell
node .\tools\verify.cjs --http-only
$httpVerifyExit = $LASTEXITCODE
Write-Host "HTTP verifier exit code: $httpVerifyExit"
```

Verifier chạy tuần tự cả ba LB: kiểm tra REST cũ, dùng Node `http2.connect` tới HTTPS 8440/8441/8442, tin cậy chứng chỉ `certs/localhost.crt`, kiểm tra `session.alpnProtocol === 'h2'`, HTTP 200 và JSON. Khi thành công có dòng `PASS ... TLS ALPN=h2, HTTP/2 /api`. Nếu một LB lỗi, script có thể dừng trước các LB tiếp theo; không diễn giải output thiếu là PASS.

Đây là lệnh kiểm tra ALPN thực tế có trong repository, **CHƯA XÁC MINH chạy trực tiếp trong lần soạn này**. HTTPS trả 200 đơn thuần không đủ chứng minh HTTP/2; tùy bản curl Windows có thể không hỗ trợ HTTP/2, nên tài liệu dùng verifier Node làm cách chính.

HTTP/2 REST ở chặng **client → LB**; chặng **LB → Express** vẫn HTTP/1.1. Kết quả không chứng minh HTTP/2 end-to-end.

### C2. Benchmark HTTP/2 từng LB (tùy thời lượng demo)

```powershell
.\benchmark\run.ps1 -Suite http2 -Balancer nginx
.\benchmark\run.ps1 -Suite http2 -Balancer haproxy
.\benchmark\run.ps1 -Suite http2 -Balancer envoy
```

Mỗi lệnh khoảng 30 giây tải với 10 VUs, thêm thời gian khởi tạo/kết thúc. Kiểm tra `HTTP 200`, `actual HTTP/2`, `REST response unchanged`, `workload_errors=0`, `http_req_failed=0`. k6 bỏ qua xác minh chứng chỉ tự ký theo cấu hình lab; verifier Node ở C1 có xác minh chứng chỉ. Không chạy cùng lúc ba bài nếu cần so sánh tài nguyên công bằng.

## Phần D — Demo gRPC Unary

### D1. Gọi Unary thật và xác nhận cả hai backend

```powershell
node .\tools\verify.cjs --grpc-only
$grpcVerifyExit = $LASTEXITCODE
Write-Host "gRPC verifier exit code: $grpcVerifyExit"
```

Script gọi `benchmark.GreeterService/SayHello` theo `backend/proto/greeter.proto`: 40 RPC mỗi LB qua một channel TLS tái sử dụng, lần lượt `localhost:9440`, `localhost:9441`, `localhost:9442`. Script xác nhận RPC không lỗi, payload `message = Hello verify`, `backend` hợp lệ và thấy cả hai backend. Output PASS nêu endpoint và hai backend, không in từng payload. Khi lỗi script có exit code khác 0. Không chạy verifier này lúc cố ý dừng một backend vì nó yêu cầu đủ hai backend.

Không kết nối `localhost:50051`: Compose không publish cổng gRPC backend ra host. Hai địa chỉ nội bộ là `backend-1:50051` và `backend-2:50051`, chỉ dùng trong mạng Docker. Gọi qua cổng 9440/9441/9442 mới kiểm tra tuyến qua LB. Client–LB dùng TLS/HTTP/2; LB–backend dùng HTTP/2 cleartext (h2c).

### D2. Benchmark gRPC từng endpoint

```powershell
.\benchmark\run.ps1 -Suite grpc -Balancer nginx
.\benchmark\run.ps1 -Suite grpc -Balancer haproxy
.\benchmark\run.ps1 -Suite grpc -Balancer envoy
```

Runner gọi đúng `benchmark/grpc-unary.js`, lần lượt đặt `GRPC_ADDR=localhost:9440/9441/9442`. Mỗi bài 10 VUs/30 giây. Kiểm tra `gRPC status OK` (gRPC status 0), `Unary payload`, `workload_errors=0`, `backend_1_responses>0`, `backend_2_responses>0`. Payload benchmark là `message = Hello benchmark` và tên backend, được kiểm tra trong script dù không in từng response. HTTP 200 riêng lẻ không thay thế gRPC status.

`unary_requests` là số lần thử; `grpc_req_duration` là độ trễ RPC. Lỗi kết nối cũng tính vào workload_errors nhưng có thể không có mẫu độ trễ RPC. Không tắt threshold hoặc đặt `PLAINTEXT=true` khi gọi listener TLS của LB. Không dùng HTTP GET `/api` làm bằng chứng gRPC.

## Phần E — Demo Failover và Recovery

**CHƯA XÁC MINH trực tiếp kịch bản sự cố này trong lần soạn tài liệu.** Chỉ chạy khi được phép gián đoạn backend để trình diễn. Đảm bảo đã định nghĩa `Show-DemoRest` ở phần B; Backend 2 phải đang hoạt động. Không chạy benchmark hiệu năng trong giai đoạn này.

### E1. Kiểm tra trạng thái ban đầu

```powershell
docker compose ps -a
curl.exe --silent --show-error --max-time 5 -i http://localhost:3001/api
curl.exe --silent --show-error --max-time 5 -i http://localhost:3002/api
Show-DemoRest -Balancer nginx -Port 8080 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer haproxy -Port 8081 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer envoy -Port 8082 -Count 10 | Format-Table -AutoSize
```

Kiểm tra hai API trực tiếp trả đúng backend, rồi quan sát phân phối qua LB. Nếu chưa bình thường, không bắt đầu dừng backend.

### E2. Dừng Backend 1 và quan sát; tự khởi động lại trong finally

```powershell
try {
    docker compose stop backend-1
    if ($LASTEXITCODE -ne 0) { throw 'Khong dung duoc backend-1' }
    docker compose ps -a

    # Quan sát ngay sau sự cố, có thể có lỗi chuyển tiếp:
    Show-DemoRest -Balancer nginx -Port 8080 -Count 10 | Format-Table -AutoSize
    Show-DemoRest -Balancer haproxy -Port 8081 -Count 10 | Format-Table -AutoSize
    Show-DemoRest -Balancer envoy -Port 8082 -Count 10 | Format-Table -AutoSize

    # Chờ minh họa cho hội tụ, không phải phép đo detection time:
    Start-Sleep -Seconds 8
    Show-DemoRest -Balancer nginx -Port 8080 -Count 10 | Format-Table -AutoSize
    Show-DemoRest -Balancer haproxy -Port 8081 -Count 10 | Format-Table -AutoSize
    Show-DemoRest -Balancer envoy -Port 8082 -Count 10 | Format-Table -AutoSize
} finally {
    docker compose start backend-1
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Can khoi phuc backend-1 bang tay theo E3' }
}
```

Ghi nhận status và backend từng request, kể cả lỗi. Sau khi LB nhận biết sự cố, response thành công kỳ vọng đến từ Backend 2; không bảo đảm không có lỗi tạm thời. Dừng container Backend 1 làm ngừng cả REST và gRPC của nó, nhưng bảng trên chỉ minh họa failover REST.

Nginx REST dùng kiểm tra lỗi **thụ động**, `max_fails=3`, `fail_timeout=5s`, phụ thuộc request/lỗi thực tế. HAProxy REST có check TCP `inter 2s fall 3 rise 2`; Envoy REST có check TCP `interval 2s`, timeout 2s, ngưỡng unhealthy 3/healthy 2. Không suy ra thời gian failover chính xác từ các con số này. Kiểm tra TCP cũng không chứng minh ứng dụng/service gRPC còn xử lý đúng.

Các LB được gọi tuần tự nên có thời gian kể từ sự cố khác nhau. Khoảng đợi 8 giây chỉ giúp trình diễn, **không đo thời gian phát hiện failover**. Muốn đo detection/recovery time phải thiết kế bài thử có timestamp, probe liên tục và điều kiện sự cố đồng nhất; tài liệu này không thực hiện phép đo đó.

### E3. Recovery và cứu hộ nếu demo bị gián đoạn

`finally` hỗ trợ khôi phục khi khối lệnh kết thúc bình thường hoặc ném lỗi; không bảo đảm chạy nếu đóng terminal/kill tiến trình hoặc máy mất điện. Khi không chắc trạng thái, mở terminal ở thư mục dự án và thực hiện:

```powershell
docker compose start backend-1 backend-2
docker compose ps -a
Start-Sleep -Seconds 8
curl.exe --silent --show-error --max-time 5 -i http://localhost:3001/api
curl.exe --silent --show-error --max-time 5 -i http://localhost:3002/api
Show-DemoRest -Balancer nginx -Port 8080 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer haproxy -Port 8081 -Count 10 | Format-Table -AutoSize
Show-DemoRest -Balancer envoy -Port 8082 -Count 10 | Format-Table -AutoSize
node .\tools\verify.cjs
```

Nếu vẫn chỉ thấy một backend, kiểm tra log, chờ hội tụ và kiểm tra lại; không tuyên bố recovery thành công chỉ vì container báo Up. Verifier đầy đủ kiểm tra REST/HTTP/2, gRPC và yêu cầu đủ hai backend trong gRPC. Mẫu REST 10 request không bảo đảm bao phủ cả hai; có thể lặp lại phần B để quan sát thêm.

Nếu container chưa được tạo hoặc LB còn dừng, dùng lệnh khởi động lại hệ thống (giữ cấu hình và dữ liệu):

```powershell
docker compose up -d
docker compose ps -a
docker compose logs --tail 80 backend-1 backend-2 nginx haproxy envoy
```

Sau đó thực hiện lại kiểm tra API/verifier; `up -d` có thể tạo lại container khi cấu hình/image thay đổi. Không dùng `down -v`, `prune`, `reset`, `clean` hoặc xóa kết quả để cứu hộ.

## Phần F — Benchmark theo từng hệ thống

### F1. Dùng runner để lưu kết quả mới

`benchmark/run.ps1` chỉ nhận `Suite = http2 | grpc | regression | all` và `Balancer = nginx | haproxy | envoy | all`. **Không có** `-Suite rest` hoặc `-Suite keepalive`. `regression` gồm REST, Keep-Alive ON, Keep-Alive OFF; `all` thêm HTTP/2 và gRPC.

```powershell
# Mỗi lệnh: 3 workload cũ cho một LB, khoảng 90 giây tải:
.\benchmark\run.ps1 -Suite regression -Balancer nginx
.\benchmark\run.ps1 -Suite regression -Balancer haproxy
.\benchmark\run.ps1 -Suite regression -Balancer envoy

# Mỗi lệnh: đủ 5 workload cho một LB, khoảng 150 giây tải:
.\benchmark\run.ps1 -Suite all -Balancer nginx
.\benchmark\run.ps1 -Suite all -Balancer haproxy
.\benchmark\run.ps1 -Suite all -Balancer envoy

# Chỉ chọn một lệnh phù hợp bên dưới nếu muốn chạy cả ba LB:
.\benchmark\run.ps1 -Suite http2 -Balancer all
.\benchmark\run.ps1 -Suite grpc -Balancer all
.\benchmark\run.ps1 -Suite regression -Balancer all
# Toàn bộ 15 bài: khoảng 450 giây tải, cộng overhead:
.\benchmark\run.ps1 -Suite all -Balancer all
```

Đây là **các lựa chọn**, không cần chạy toàn bộ khối nối tiếp. Mỗi lần gọi runner tạo thư mục `benchmark/results/run-<timestamp>-<id>/` riêng, chứa JSON, console log, exit code, metadata và `chapter4-results.md` của lần chạy đó. Không ghi đè `docs/chapter4-results.md`. Không chạy lại summarizer vào thư mục đã có bảng tổng hợp vì công cụ dùng chế độ tạo file mới (`wx`).

### F2. Chỉ chạy riêng REST hoặc Keep-Alive ON/OFF

Chọn `$lb` bằng một trong `nginx`, `haproxy`, `envoy`; khối sau lấy đúng cổng tương ứng và tạo thư mục export mới bằng GUID. Có thể chạy một trong ba lệnh k6 sau phần chuẩn bị để tiết kiệm thời gian. Chúng dùng nguyên script cũ, 10 VUs/30 giây mỗi lệnh.

```powershell
$lb = 'nginx' # Doi thanh 'haproxy' hoac 'envoy' khi can
$restPorts = @{ nginx = 8080; haproxy = 8081; envoy = 8082 }
if (-not $restPorts.ContainsKey($lb)) { throw 'Ten LB khong hop le' }
$baseUrl = 'http://localhost:{0}' -f $restPorts[$lb]
$demoOutput = Join-Path '.\benchmark\results' ('demo-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $demoOutput -ErrorAction Stop | Out-Null

k6 run -e "BASE_URL=$baseUrl" --summary-trend-stats 'avg,min,med,max,p(90),p(95)' --summary-export "$demoOutput\$lb-rest.json" .\benchmark\rest-api.js
k6 run -e "BASE_URL=$baseUrl" -e KEEP_ALIVE=on --summary-export "$demoOutput\$lb-keepalive-on.json" .\benchmark\keep-alive.js
k6 run -e "BASE_URL=$baseUrl" -e KEEP_ALIVE=off --summary-export "$demoOutput\$lb-keepalive-off.json" .\benchmark\keep-alive.js
```

Nếu chạy lại, chạy lại cả phần tạo GUID/thư mục trước để tránh ghi đè. Các lệnh k6 trực tiếp không tạo metadata/bảng tổng hợp của runner. REST và Keep-Alive cũ có checks nhưng không đặt threshold; **exit code 0 không đủ**, cần kiểm tra checks không thất bại, `http_req_failed=0`. Đọc `http_reqs` (count/rate), `http_req_duration` (avg, p90, p95). Với HTTP/2/gRPC dùng runner ở C2/D2 để có lưu trữ đầy đủ.

Round Robin là **thuật toán chọn backend**; REST, Keep-Alive ON/OFF, HTTP/2, gRPC Unary là **workload/điều kiện kết nối**. Đổi workload không đổi thuật toán cân bằng tải. Keep-Alive script điều khiển tái sử dụng kết nối phía k6, không trực tiếp cấu hình kết nối upstream của LB; script còn có sleep 50 ms, hai workload mới không sleep. Không so trực tiếp RPS REST/HTTP/2/gRPC để kết luận giao thức nào tốt hơn khi payload/đường xử lý chưa tương đương.

### F3. Khi không đủ thời gian chạy lại

```powershell
$evidence = '.\benchmark\results\run-20261108-214448-206-b8432507'
Get-Content -LiteralPath "$evidence\chapter4-results.md" -Encoding UTF8
Get-Content -LiteralPath "$evidence\runs.json" -Raw -Encoding UTF8 | ConvertFrom-Json | Format-Table balancer, workload, exitCode -AutoSize
docker stats --no-stream
```

Nói rõ đây là bằng chứng đã lưu của ngày 08/11/2026; `docker stats` là tài nguyên tại thời điểm hiện tại, không phải lịch sử của lần đo đó. Không sửa số liệu cũ hoặc gắn nhãn là vừa đo trực tiếp.

## Phần G — Kết thúc demo

Trước khi tắt, bảo đảm Backend 1 đã được phục hồi, cả 5 container hoạt động và kiểm tra chức năng thành công. Nếu verifier lỗi, đọc log và ghi nhận thay vì tuyên bố PASS.

```powershell
docker compose start backend-1 backend-2
docker compose ps -a
node .\tools\verify.cjs
Write-Host "Final verifier exit code: $LASTEXITCODE"
```

Sau khi đã kiểm tra xong, chọn **một** cách dừng:

```powershell
# Dung container, giu container/network de lan sau start nhanh:
docker compose stop
docker compose ps -a
```

```powershell
# Tuy chon: dung va go container/network Compose, khong them -v:
docker compose down
```

`down` chủ đích gỡ container/network của dự án; không xóa source, chứng chỉ hay kết quả bind-mount trên host. Dùng `stop` nếu muốn giữ nguyên container. Không tắt Docker Desktop khi còn demo/benchmark chưa kết thúc, không dùng lệnh xóa volume/image hoặc thư mục kết quả.

### Những điểm nên giải thích khi giảng viên hỏi

- Ba LB độc lập, cùng hai backend; cổng host khác nhau không có nghĩa là ba tầng proxy nối tiếp.
- Nhận diện backend bằng JSON REST (`message`, `port`) và trường `backend` trong gRPC reply; status thành công riêng lẻ không chứng minh phân phối đều.
- HTTP/2 được chứng minh bằng protocol check và ALPN `h2`, không chỉ HTTPS. gRPC là RPC có proto/status/payload thật, không phải GET `/api`.
- TLS kết thúc ở LB; REST upstream HTTP/1.1, gRPC upstream h2c. Chứng chỉ lab tự ký; k6 và verifier có cách xác minh cert khác nhau.
- Round Robin cấu hình khác với tỷ lệ quan sát trong mẫu nhỏ; failover sau sự cố khác với phép đo detection time. Health check TCP khác kiểm tra sức khỏe tầng ứng dụng.
- Kết quả phụ thuộc host, tài nguyên dùng chung, version image và workload. Một vòng 30 giây chưa đủ để kết luận tổng quát; so sánh ba LB trong cùng workload và cần lặp/đổi thứ tự cho báo cáo nghiên cứu.

## Phạm vi kiểm tra tài liệu

Đã đối chiếu `docker-compose.yml`, ba cấu hình LB, bốn script k6, `benchmark/run.ps1`, `tools/validate.ps1`, `tools/verify.cjs`, generator cert, summarizer, proto/backend và hai tài liệu hướng dẫn/xác minh. Các khối PowerShell được kiểm tra bằng parser, không thực thi nội dung khối. Kiểm tra khởi tạo script bằng `k6 inspect` không gửi tải và không chứng minh endpoint đang hoạt động.

**CHƯA XÁC MINH trong lần soạn:** Docker runtime, API/gRPC trên endpoint hiện tại, verifier TLS/ALPN, kịch bản stop/start/failover/recovery, lệnh benchmark thực chạy và thao tác kết thúc demo. Môi trường agent hiện không tìm thấy Docker CLI trong PATH. Không chạy `tools/validate.ps1` trong lần soạn vì script đó build/start Compose; không chạy `tools/test-local.cjs` vì nó khởi chạy backend và smoke test. Không thay đổi cấu hình, logic benchmark, kết quả hoặc tài liệu cũ; không commit/push.
