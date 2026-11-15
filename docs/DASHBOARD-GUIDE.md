# Load Balancer Benchmark Dashboard

Dashboard độc lập, giao diện tiếng Việt, dark mode; dùng để quan sát REST Round Robin thật, trình bày benchmark lịch sử và chạy k6 sau khi người dùng xác nhận tại mục 04. Không thay đổi Docker Compose, cấu hình LB, backend, script hay kết quả đã lưu. Mở trang không tự chạy benchmark; giao diện không nhận shell command. Server chỉ bind `127.0.0.1`.

## Môi trường và cài đặt

### RUN chính thức được ghim và bảo vệ

Mục 03 luôn đưa `web-full-2026-11-15T14-13-23-595Z-106fae93` lên đầu và mặc định chọn RUN này khi mở/tải lại trang. Dropdown và dòng mô tả hiển thị **📌 RUN chính thức · 15/15 PASS · CPU/RAM**. Đây là nhãn của RUN được chỉ định, không sửa bất kỳ số liệu hay metadata benchmark nào. Đã kiểm tra RUN có đủ 15 hàng PASS và 15 bài tài nguyên, mỗi bài 30 mẫu hợp lệ.

Nút **Xóa đợt kiểm thử** bị khóa, màu xám/mờ, tooltip **RUN chính thức của đồ án được bảo vệ, không thể xóa**. Backend cũng từ chối cả API chuyển thùng rác và khôi phục với HTTP 403, kể cả biến thể chữ hoa/thường của ID. Không có chức năng xóa vĩnh viễn/tự dọn thùng rác. RUN lịch sử cũ và hai legacy vẫn được bảo vệ như trước; các RUN thử nghiệm khác vẫn xem/xóa/khôi phục theo điều kiện hiện có.

Chọn RUN khác để xem bình thường; nút **Làm mới kết quả** giữ lựa chọn hợp lệ đang xem. Mở hoặc tải lại trang sẽ chọn mặc định RUN ghim. Sau khi chuyển RUN thử nghiệm vào thùng rác, giao diện chọn lại RUN chính thức mới. Nếu dữ liệu RUN ghim không có trên máy, Dashboard không tự tạo dữ liệu thay thế; mặc định trở về RUN lịch sử nếu có, rồi đợt khả dụng đầu tiên.

Sau khi cập nhật code, dừng tiến trình Dashboard đang dùng bằng Ctrl+C khi không có benchmark cần giữ chạy, khởi động lại `node .\dashboard\server.cjs`, rồi tải lại trình duyệt để server nạp chính sách mới. Việc ghim/bảo vệ được khai báo trong `dashboard/benchmark-policy.cjs`, tách khỏi các file kết quả. Các runner giữ nguyên cơ chế ID mới + tạo thư mục mới không ghi đè; không có tham số chọn ID đích để sửa RUN ghim.

Windows PowerShell, Node.js >= 20 (đã kiểm tra trên v24.11.0), trình duyệt hiện đại. Không có dependency ngoài, không cần `npm install`, không cần Internet/CDN. Biểu đồ dùng HTML/CSS với nhãn số và đơn vị, hoạt động offline. Docker và hệ thống LB cần đang chạy nếu muốn demo trực tiếp; xem benchmark lịch sử không cần Docker.

## Khởi động

Mở PowerShell tại repository:

```powershell
Set-Location 'D:\6. ĐỒ ÁN CHUYÊN NGÀNH'
node .\dashboard\server.cjs
```

Mở **http://127.0.0.1:5173**. Có thể mở bằng:

```powershell
Start-Process 'http://127.0.0.1:5173'
```

Giữ cửa sổ chạy server mở. Dừng bằng **Ctrl+C** tại cửa sổ đó; thao tác này chỉ dừng Dashboard.

Nếu 5173 đang bận, không dừng tiến trình khác:

```powershell
$env:DASHBOARD_PORT = '5174'
node .\dashboard\server.cjs
# Mo http://127.0.0.1:5174
```

## Demo trực tiếp

1. Nhấn **Làm mới trạng thái** để kiểm tra `/api` tại 8080, 8081, 8082, 3001, 3002. Online cần HTTP 200 và JSON nhận diện backend hợp lệ (backend trực tiếp phải khớp tên). Offline nghĩa là không kết nối được hoặc HTTP lỗi. Unknown nghĩa là phản hồi không đủ xác nhận ứng dụng. Đây không phải kiểm tra Docker/TLS/HTTP2/gRPC.
2. Ở **02. Demo các thuật toán cân bằng tải**, chọn Load Balancer và thuật toán. Chỉ **Round Robin** đã được triển khai; Weighted Round Robin, Least Connections, IP Hash có nhãn **Chưa triển khai**, bị vô hiệu hóa. Server cũng từ chối thuật toán khác, dropdown không thay đổi cấu hình LB thật.
3. Chọn **Tốc độ trình diễn**: Nhanh nghỉ 0,15 giây, Bình thường (mặc định) nghỉ 1 giây, Chậm nghỉ 1,8 giây giữa các yêu cầu. Nhấn **Gửi 10 yêu cầu** hoặc **Gửi 20 yêu cầu**; **Kiểm thử cả 3 LB** lần lượt chạy 10 yêu cầu mỗi LB và hiển thị kết quả LB hiện tại. Mỗi lượt dùng HTTP GET `/api` thật, tuần tự, kết nối mới, timeout 2 giây/yêu cầu. Không tải lại tab lúc đang chạy.
4. Backend nhận diện từ `JSON.port = 3001/3002`; không suy đoán từ thứ tự. Bảng giữ request number, LB, backend hoặc lỗi, HTTP status và thời gian từ server Dashboard (ms, gồm chi phí kết nối/đọc JSON).
5. Sơ đồ **Máy khách → Load Balancer → Backend 1/2** sáng theo từng sự kiện thực. Lịch sử xuất hiện ngay sau mỗi phản hồi, dòng mới nhất được làm nổi bật; tiến trình tăng cả khi yêu cầu thất bại. Bộ đếm xanh Backend 1, xanh dương Backend 2, hồng thất bại/không xác nhận luôn có tổng bằng số yêu cầu đã xử lý. Phần trăm dùng số phản hồi đã nhận. HTTP lỗi không cộng vào số yêu cầu thành công của backend; nếu JSON lỗi vẫn nhận diện backend, lịch sử ghi rõ nguồn phản hồi đó.

6. API mới `POST /api/demo-stream/<nginx|haproxy|envoy>?algorithm=round-robin&count=10&speed=normal` trả NDJSON, thứ tự `start → request → result → … → done`. Frontend đọc từng sự kiện ngay khi đến, không chờ đủ 10 rồi phát lại hoạt ảnh. Khoảng nghỉ trình diễn không tính vào ms phản hồi; thời gian một lượt bình thường khoảng 9/19 giây nghỉ cho 10/20 yêu cầu cộng thời gian HTTP. Offline có thể mất thêm tối đa 2 giây/yêu cầu. Đóng tab ngừng gửi các yêu cầu tiếp theo; một yêu cầu đang thực hiện có thể hoàn tất trong timeout.
7. **Đặt lại kết quả** xóa lịch sử, bộ đếm, tiến trình và hiệu ứng demo; không ảnh hưởng benchmark. Khi đang chạy, các điều khiển bị khóa. Mỗi lượt mới hoặc đổi LB sẽ xóa mẫu demo trước; không lưu lịch sử qua tải lại trang. Mẫu nhỏ không bảo đảm chia đều hay xen kẽ tuyệt đối và không phải benchmark hiệu năng.

Mở trang chỉ kiểm tra trạng thái và tải kết quả; nút demo mới gửi yêu cầu. Server chặn demo trong khi benchmark chạy và ngược lại, để hạn chế ảnh hưởng số đo. API cũ `POST /api/round-robin/<LB>` vẫn trả `{ rows }` gồm 10 request như trước. Không có chức năng dừng/khởi động container hoặc failover chủ động.

## 04. Chạy Benchmark trực tiếp

### Chuẩn bị và chạy lần đầu

1. Cài k6 từ nguồn chính thức nếu chưa có. Mở PowerShell mới, kiểm tra đường dẫn (không tạo tải):

```powershell
Get-Command k6
k6 version
```

2. Hệ thống LB/backend cần đang hoạt động. Dashboard không tự khởi động Docker hoặc sửa cấu hình. Sau khi cài k6, khởi động lại tiến trình Dashboard để nhận PATH mới. Không mở hai Dashboard để chạy benchmark cùng lúc, không chạy benchmark ngoài Dashboard hoặc demo trong lúc đo.
3. Mở mục **04. Chạy Benchmark trực tiếp**. Chọn **Nginx** và **REST API** cho lượt đầu; có thể chọn HAProxy, Envoy hoặc **Cả ba (tuần tự)** và một trong năm loại kiểm thử.
4. Xem VUs/duration đọc từ script: hiện tại **10 VUs, 30s/bài**, không có ô tự nhập tham số. Keep-Alive giữ khoảng nghỉ 50 ms của script gốc. Nếu không đọc được thông số cố định hoặc thiếu k6, nút chạy bị khóa.
5. Nhấn **Chạy Benchmark**, đọc hộp xác nhận rồi chọn đồng ý khi sẵn sàng tạo tải thật. Chọn Hủy sẽ không gửi yêu cầu chạy. Khi xác nhận, server kiểm tra k6 và listener LB đã chọn trước khi tạo job; chỉ một job được chạy tại một thời điểm, kể cả giữa các Dashboard dùng cùng thư mục kết quả.
6. Theo dõi trạng thái, thời điểm bắt đầu, thời gian đã chạy, LB/workload hiện tại, số bài hoàn thành/tổng số bài và log stdout/stderr. Trạng thái được đọc lại mỗi giây; không có phần trăm giả. Đọc log có thể trễ tối đa khoảng một nhịp polling. Cả ba LB chạy tuần tự, khoảng 90 giây tải cộng overhead, giới hạn cứng **90 giây/bài** để xử lý trường hợp treo.
7. Khi hoàn tất, danh sách kết quả tự làm mới, chọn đúng mã đợt và workload vừa chạy tại mục **03. Kết quả benchmark đã lưu**. Nhấn **Xem kết quả** để chuyển đến bảng/biểu đồ. Với một LB, hai LB không chạy hiển thị N/A. Với job thất bại/dở dang, giữ dữ liệu đã có, FAIL theo bằng chứng hoặc N/A nếu chưa có số đo; không lấy số từ đợt khác bù vào.

### Cách thực thi và nơi lưu

Runner PowerShell hiện chỉ chọn suite `http2`, `grpc`, `regression`, `all`; không chọn riêng REST hay một Keep-Alive. Adapter `dashboard/benchmark-runner.cjs` gọi trực tiếp executable k6 trong PATH bằng `spawn` với `shell:false`, `windowsHide:true`, danh sách script và endpoint cố định. Các đối số theo runner gốc: `run`, `--summary-trend-stats=avg,min,med,max,p(90),p(95)`, `--summary-export=<file mới>`, `-e BASE_URL=...` hoặc `-e GRPC_ADDR=...`; Keep-Alive thêm `-e KEEP_ALIVE=on/off`. Không override VUs/duration của script. Loại bỏ biến môi trường `K6_*`, `BASE_URL`, `GRPC_ADDR`, `PLAINTEXT`, `KEEP_ALIVE` kế thừa trước khi đặt lựa chọn cố định, tránh vô tình đổi điều kiện kiểm thử.

REST/Keep-Alive preflight kiểm tra HTTP 200 và JSON backend tại cổng REST. HTTP/2/gRPC preflight kiểm tra kết nối listener TLS đúng cổng, chứng chỉ lab `certs/localhost.crt` và ALPN h2; không phải bằng chứng RPC/payload thành công. Các checks và thresholds trong k6 mới xác nhận chất lượng workload. k6 vẫn giữ chính sách TLS của script gốc; adapter không sửa cert hoặc script.

Mỗi job tạo `dashboard/results/web-<timestamp>-<id>/` hoàn toàn mới, gồm:

- `<lb>-<workload>.json`: summary k6 gốc, nếu k6 tạo được.
- `<lb>-<workload>.log`: đầy đủ stdout/stderr, phân biệt nguồn bằng nhãn.
- `runs.json`: từng bài, exit code, PASS/FAIL, thời gian, đối số, thông số và lỗi.
- `metadata.json`: lựa chọn LB/workload, thời gian, trạng thái job, VUs/duration, đường dẫn executable, hash script, giới hạn thời gian và cờ dừng.

Log hiển thị trên web giữ 64 KiB cuối; file `.log` giữ toàn bộ. Thư mục runtime được ignore bởi `dashboard/.gitignore`, vẫn tồn tại trên ổ đĩa. Không ghi bất cứ file nào vào `benchmark/results/`. Không tự tạo summary khi k6 thất bại trước lúc export. Dữ liệu fixture dùng kiểm thử nằm riêng trong thư mục tạm, bị xóa sau test và không xuất hiện trong danh sách benchmark.

### Dừng an toàn và mất kết nối

- Nhấn **Dừng benchmark** và xác nhận. Server gửi tín hiệu dừng tới đúng tiến trình k6 do mình tạo, chờ đóng rồi lưu trạng thái thất bại; không chạy các LB còn lại. Sau 3 giây, nếu tiến trình chưa thoát thì buộc dừng. Trên Windows, tín hiệu dừng có thể kết thúc tiến trình ngay nên summary có thể chưa được export; log/metadata và dữ liệu đã có được giữ lại.
- Nhấn **Ctrl+C** ở cửa sổ server cũng yêu cầu dừng k6 và lưu metadata trước khi thoát. Không đóng cưỡng bức cửa sổ hoặc kill tiến trình nếu muốn giữ trạng thái hoàn chỉnh.
- Đóng tab không dừng benchmark. Mở lại cùng server để tiếp tục xem trạng thái/log của job hiện tại. Sau khi khởi động lại server, trạng thái trực tiếp là Chưa chạy; các đợt đã lưu vẫn xem được ở mục 03.
- Trường hợp kill cứng/mất điện có thể để lại `dashboard/results/.benchmark.lock` và metadata đang chạy. Chỉ xóa khóa khi đã xác nhận mọi tiến trình Dashboard/k6 liên quan đều dừng; không tự xóa khi chưa rõ job nào còn chạy. Không xóa thư mục kết quả:

```powershell
# Chi chay sau khi da xac nhan moi Dashboard/k6 lien quan deu dung:
Remove-Item -LiteralPath '.\dashboard\results\.benchmark.lock'
```

### Lỗi thường gặp khi chạy k6

- Thiếu k6: cài k6, kiểm tra `Get-Command k6`, khởi động lại Dashboard. Không dùng URL hoặc command tùy ý để chỉ định executable.
- LB offline/timeout hoặc TLS/ALPN lỗi: server từ chối chạy; xem trạng thái và log hệ thống hiện có. Không tự sửa config hoặc bật Docker từ Dashboard.
- Job đã chạy: chờ hoàn tất hoặc dừng đúng Dashboard đang giữ job; khóa chung chống hai phiên dùng cùng output root. Không thể khóa các lệnh k6 do người dùng chạy bên ngoài Dashboard, vì vậy tránh chạy chúng đồng thời.
- FAIL dù exit code 0: các script REST/Keep-Alive không đặt threshold; Dashboard còn kiểm tra checks, request count và error rate. Chỉ exit code 0 chưa đủ PASS.
- JSON lỗi/mất summary: giữ log và đánh dấu thất bại, các giá trị thiếu là N/A. Không sửa summary để biến FAIL thành PASS.
- Không ghi được file: kiểm tra dung lượng/quyền ghi `dashboard/results/`; không chuyển output vào thư mục lịch sử.

## Benchmark lịch sử

### FULL RUN PowerShell: 15 bài k6 kèm CPU/RAM

Runner mới `dashboard/run-full-benchmark.ps1` độc lập với nút chạy benchmark ở mục 04. Không sửa/gọi lại runner PowerShell gốc để ghi vào thư mục lịch sử. Node adapter tái sử dụng các hàm hiện có để tìm k6, đọc thông số script, kiểm tra endpoint, tạo đối số, xử lý môi trường, chuẩn hóa PASS/FAIL và thu thập Docker Stats.

**Lệnh từ thư mục gốc dự án:**

```powershell
Set-Location 'D:\6. ĐỒ ÁN CHUYÊN NGÀNH'

# Chi kiem tra dieu kien, KHONG chay tai k6:
.\dashboard\run-full-benchmark.ps1 -CheckOnly

# Chay du 15 bai; nhap dung RUN khi duoc hoi de xac nhan:
.\dashboard\run-full-benchmark.ps1
```

Không chạy `-CheckOnly` hoặc benchmark/demo khác trong lúc đang có một lượt benchmark. Các lệnh trên là lựa chọn do bạn chủ động thực hiện; việc cài đặt Dashboard/mở trang không gọi chúng. PowerShell yêu cầu `node` trong PATH. Docker CLI không bắt buộc nếu Engine API cục bộ đọc được; k6 phải có trong PATH. Nếu chạy Docker bằng rootless socket hoặc named pipe khác, cấu hình `DASHBOARD_DOCKER_SOCKET` như phần Monitor trước khi chạy.

**Điều kiện bắt buộc trước tải:**

- Tìm k6 và đọc `k6 version`.
- Kết nối Docker Engine; đủ năm container `nginx-lb`, `haproxy-lb`, `envoy-lb`, `backend-1`, `backend-2`, đang chạy, không paused/restarting.
- Đọc cấu hình VUs/duration và SHA-256 từ năm workload; không override script hoặc điều kiện tải. Kiểm tra lại hash trước từng bài để từ chối script bị sửa giữa lượt.
- Kiểm tra endpoint của 15 tổ hợp bằng hàm preflight hiện có. REST/Keep-Alive dùng HTTP `/api`; HTTP/2 và gRPC kiểm tra TLS/ALPN listener. Payload/protocol/gRPC status và checks thực tế được xác minh bởi script k6 trong từng bài, không suy ra từ handshake.
- Kiểm tra đọc Stats của đúng ba LB, counter CPU/RAM và tên container hợp lệ. Các mẫu kiểm tra quyền này không được đưa vào resource-metrics của bài tải.
- Dùng cùng `.benchmark.lock` với runner web và chức năng quản lý dữ liệu. Thiếu điều kiện hoặc đã có khóa thì dừng trước khi spawn bài tải; không tự bật Docker, dừng container hoặc xóa khóa cũ.

**Thứ tự giống runner chính thức cũ:** Nginx → HAProxy → Envoy; mỗi LB: HTTP/2 → gRPC Unary → REST → Keep-Alive ON → Keep-Alive OFF. Hiện mỗi bài 10 VUs/30s, tổng **450 giây tải** cộng overhead. Chạy tuần tự, không có warm-up tách riêng, không thay payload/khoảng nghỉ Keep-Alive. Console hiển thị LB/workload, số bài hoàn thành trên 15 và stdout/stderr k6 thực tế. Giới hạn 90 giây/bài; không bảo đảm hoàn thành dưới 15 phút nếu nhiều bài lỗi/timeout.

**Kết quả:** mỗi lần tạo một thư mục mới:

```text
dashboard/results/web-full-<timestamp>-<id>/
  nginx-http2.json / nginx-http2.log
  ... đủ tên riêng cho từng tổ hợp đã thực hiện ...
  runs.json
  metadata.json
  resource-metrics.json
  k6-version.txt
```

Không dùng lại ID/thư mục có sẵn. JSON/log k6 giữ nguyên nội dung do k6 sinh; mỗi file có tên LB/workload riêng. `runs.json` lưu exit code, PASS/FAIL, thời gian, đối số, VUs/duration và `resourceStatus` từng bài. Metadata ghi kế hoạch 15 bài, hash script, phiên bản k6, Docker API và snapshot ID/image của năm container (không ghi environment/private key). Checkpoint chỉ cập nhật file trong thư mục mới do chính lượt hiện tại tạo ra, không sửa đợt cũ.

File tài nguyên **schema 2** có `workload: all`, tối đa 15 measurement, khóa duy nhất là **LB + workload**; mỗi measurement giữ nguyên định dạng mẫu/thống kê của Monitor. Bộ đọc tiếp tục hỗ trợ schema 1 của job web. Mỗi bài khởi tạo baseline CPU mới và chỉ lấy mẫu trong vòng đời tiến trình k6, không dùng mẫu preflight hoặc mẫu bài trước. Dữ liệu được lưu checkpoint sau từng bài và cuối lượt. Không cộng CPU/RAM các bài hay các container.

**PASS/FAIL và hủy:**

- Tiêu chí PASS/FAIL hiệu năng vẫn dùng bộ chuẩn hóa hiện tại; exit code 0 riêng lẻ chưa đủ PASS. Bài lỗi giữ FAIL, tiếp tục các tổ hợp còn lại nếu không bị hủy.
- `performanceState` đánh giá 15 bài k6; `resourceState` đánh giá chất lượng thu thập. Mỗi bài cần có mẫu đủ cả CPU/RAM và collector hoàn tất không lỗi để được `resourceStatus: COMPLETE`.
- FULL RUN chỉ có `state: success` và exit code 0 khi hiệu năng và tài nguyên đều đầy đủ. Ví dụ k6 PASS nhưng Docker Stats lỗi: hàng hiệu năng vẫn PASS, `resourceStatus: ERROR`, resourceState error và FULL RUN failed; không gán số tài nguyên giả để làm đẹp kết quả.
- Nhấn **Ctrl+C** ở cửa sổ PowerShell để yêu cầu hủy: dừng collector, gửi tín hiệu đến đúng child k6, sau tối đa 3 giây buộc dừng nếu cần, lưu kết quả đã có và không chạy bài tiếp theo. Bài chưa thực hiện hiển thị N/A. Không dùng nút Dừng mục 04 để dừng runner CLI độc lập.
- Không đóng cưỡng bức terminal/kill Node. Hard kill hoặc mất điện có thể làm mất bài đang ghi và để lại khóa; xử lý theo hướng dẫn khóa sau khi chắc chắn không còn tiến trình chạy. Runner không tự xóa dữ liệu hoặc tự xóa khóa của phiên khác.

**Mở kết quả trên Dashboard:** khởi động server, nhấn **Làm mới kết quả** ở mục 03, chọn đúng ID `web-full-...` được console in ra, chọn workload. Bảng và bốn biểu đồ hiệu năng cũ vẫn so sánh ba LB cùng đợt; khối CPU/RAM bên dưới hiển thị đúng ba bài của workload đó cùng hai biểu đồ tài nguyên mỗi LB. Đợt cũ thiếu tài nguyên hiển thị N/A. Mục 04 vẫn giữ luồng job web một workload như trước; không điều khiển hay hiển thị tiến trình CLI đang chạy.

Các FULL RUN hoàn tất trong dashboard/results có thể chuyển thùng rác/khôi phục sau khi backend xác minh metadata riêng, kế hoạch, script và vị trí thực. Đợt đang chạy/ghi vẫn bị khóa. Các đợt `benchmark/results/`, đợt chính thức cũ và legacy luôn được bảo vệ. Khóa không ngăn được k6 do bạn chạy ngoài Dashboard/runner này; không chạy tải hoặc demo mục 02 đồng thời. Mọi container vẫn chia sẻ tài nguyên host, cần ghi môi trường máy và chạy lặp trước khi kết luận tổng quát cho đồ án.

### CPU/RAM Monitor trong mục 04

Khi bạn xác nhận **Chạy Benchmark**, bộ thu thập tự theo dõi đúng container: Nginx → `nginx-lb`, HAProxy → `haproxy-lb`, Envoy → `envoy-lb`. Không đo backend, không cộng nhiều container. Không cần Docker CLI nếu Dashboard có quyền đọc named pipe/socket Docker Engine cục bộ.

**Cách sử dụng:**

1. Chạy Dashboard như hướng dẫn, chọn LB và workload ở mục 04, xác nhận tạo tải khi sẵn sàng.
2. Xem **CPU/RAM Monitor**: tên container, trạng thái, thời gian đo, CPU/RAM mẫu mới nhất, hai biểu đồ và thống kê. UI đọc cùng API trạng thái mỗi giây; lúc chưa đủ mốc CPU hoặc Docker lỗi hiển thị N/A.
3. Với **Cả ba**, mỗi bài có cửa sổ đo và danh sách mẫu riêng. Giao diện tự theo bài đang chạy. Khi kết thúc, dùng **Xem bài đo** để chọn từng LB; không gộp CPU/RAM giữa các bài.
4. Nhấn **Dừng benchmark** để dừng cả lấy mẫu; request Docker đang chờ bị hủy, không để sampler tiếp tục chạy nền. Dừng hoặc timeout không làm mất các mẫu đã nhận.
5. Sau khi job kết thúc, chọn đợt ở mục 03 để xem khối **CPU/RAM của đợt đã lưu**. Bảng và bốn biểu đồ hiệu năng cũ giữ nguyên. Các đợt trước khi có monitor hiển thị **Chưa thu thập dữ liệu tài nguyên**; không bổ sung dữ liệu vào các đợt cũ.

**Nguồn và cách tính:**

- Node gọi Docker Engine API bằng HTTP qua named pipe/Unix socket cục bộ, không dùng shell hoặc URL/container do frontend nhập. Đọc `/version` để chọn phiên bản API, sau đó GET `/containers/<tên cố định>/stats?stream=false&one-shot=true`. Chỉ hỗ trợ số liệu Linux containers trong phiên bản này, phù hợp các image Compose của dự án.
- Mục tiêu một mẫu/giây, không chạy hai request Docker chồng lên nhau. Mỗi lần đọc có timeout 1,5 giây; khi Docker chậm, khoảng lấy mẫu thực tế có thể dài hơn 1 giây. Mỗi mẫu có timestamp nhận, tên container; mẫu thành công có thêm timestamp Docker và mốc CPU trước đó.
- **CPU% = chênh lệch CPU container / chênh lệch CPU hệ thống × số CPU online × 100.** 100% xấp xỉ một lõi được dùng hết; 300% có thể tương đương khoảng ba lõi. Không chặn ở 100%. Với Docker Desktop, số lõi/counters thuộc môi trường Docker/Linux VM, không đồng nhất với phần trăm CPU toàn máy trong Windows Task Manager.
- CPU chỉ dùng hai mốc nằm trong cùng bài. Mẫu đầu có thể có RAM nhưng CPU là N/A để tránh dùng khoảng thời gian trước benchmark. Counter reset/không hợp lệ không được gán 0.
- **RAM: MiB = byte / 1.048.576.** Lấy `memory_stats.usage`, trừ `inactive_file` trên cgroup v2 hoặc `total_inactive_file` trên cgroup v1 nếu có. Đây gần với cách Docker CLI hiển thị trên Linux, không phải RSS đơn thuần. Nếu Docker không cung cấp trường cache, dùng usage thô và ghi rõ trong mẫu/giao diện; không giả định cache bằng 0 rồi gọi là cùng định nghĩa.
- CPU/RAM trung bình là trung bình cộng các mẫu hợp lệ của từng chỉ số; cao nhất là giá trị lớn nhất trong các mẫu, không bảo đảm bắt được đỉnh giữa hai lần đọc. Hiển thị số mẫu CPU, RAM và mẫu có đủ cả hai. Mẫu lỗi giữ giá trị null/N/A, không đưa vào trung bình; CPU/RAM bằng 0 chỉ xuất hiện khi counter thực sự cho kết quả 0 hợp lệ.

Tham khảo chính thức: [Docker stats và cách xử lý memory cache](https://docs.docker.com/reference/cli/docker/container/stats/), [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.41/).

**Phạm vi thời gian và lưu trữ:**

Khoảng đo bắt đầu khi tiến trình k6 thực sự được spawn và kết thúc khi tiến trình đóng, timeout hoặc người dùng yêu cầu dừng. Không lấy mẫu khi preflight/chờ job hoặc giữa hai LB. Đây là cửa sổ vòng đời k6, bao gồm khởi tạo/kết thúc; không tuyên bố đã tách chính xác chỉ pha tải VUs 30 giây của k6. Chỉ timestamp Docker hợp lệ trong khoảng bắt đầu đo mới được dùng; clock lệch giữa host/VM có thể gây cảnh báo.

Mỗi đợt mới có `resource-metrics.json`, schema version 1, gồm jobId/workload/đơn vị và `measurements` riêng cho từng LB: container, thời điểm bắt đầu/kết thúc, nguồn/cách tính, mẫu, lỗi, thống kê và trạng thái. File được tạo mới (`wx`) sau khi kết thúc các bài, trước khi giải phóng khóa job. Không ghi vào JSON k6 và không cập nhật file của đợt đã có. Trong lúc chạy, dữ liệu trực tiếp nằm trong API trạng thái. Nếu server bị kill cứng/mất điện trước khi lưu, dữ liệu monitor trong RAM có thể mất; hãy dùng nút Dừng hoặc Ctrl+C để kết thúc có kiểm soát.

Thất bại thu thập hoặc lỗi lưu file tài nguyên chỉ tạo cảnh báo tài nguyên, **không thay đổi tiêu chí PASS/FAIL của benchmark k6**. Resource file đi theo cả thư mục khi chuyển vào thùng rác/khôi phục; không có đường dẫn tách rời cần sửa. CSV hiệu năng cũ vẫn giữ nguyên định dạng.

**Docker không hoạt động hoặc thiếu quyền:**

Mặc định Windows thử `\\.\pipe\docker_engine`, rồi `\\.\pipe\dockerDesktopLinuxEngine`; Linux dùng `/var/run/docker.sock`. Không tự khởi động Docker, không mở cổng Docker TCP, không sửa quyền truy cập hoặc Compose. Nếu môi trường của bạn dùng pipe/socket cục bộ khác, đặt biến môi trường trước khi chạy Dashboard:

```powershell
$env:DASHBOARD_DOCKER_SOCKET = '\\.\pipe\dockerDesktopLinuxEngine'
node .\dashboard\server.cjs
```

Biến này chỉ nhận đường dẫn pipe/socket cục bộ, không nhận URL Docker từ frontend và không tự dùng Docker context/DOCKER_HOST trỏ máy khác. Với Docker rootless, có thể chỉ định Unix socket phù hợp bằng cùng biến môi trường.

- `EPERM`/`EACCES`: môi trường chạy Dashboard không được đọc Docker pipe/socket. Chạy từ môi trường được cấp quyền Docker hiện có; không bật quyền truy cập toàn mạng để khắc phục.
- `ENOENT`/connection refused: Docker chưa chạy hoặc đường dẫn pipe/socket không đúng. Khi chưa truy cập được, monitor báo lỗi và N/A; benchmark vẫn được đánh giá theo kết quả k6 nếu điều kiện preflight hợp lệ.
- HTTP 404: container không tồn tại hoặc API không được hỗ trợ; kiểm tra đúng tên container Compose. Không tự dò/gán số liệu container khác.
- JSON/counter lỗi, sai tên container, timestamp không hợp lệ: bỏ giá trị không đáng tin và ghi lỗi. Container bị tạo lại trong lúc đo không được trộn counter với container cũ.

**Demo cho giảng viên:** ưu tiên một LB và một workload, giải thích hai đơn vị, quan sát khoảng lấy mẫu rồi xem bảng trung bình/cao nhất khi kết thúc. Chỉ chạy cả ba khi đủ thời gian; không mở thêm benchmark/demo đồng thời. Monitor tạo thêm chi phí truy vấn nhỏ và host/VM vẫn dùng chung tài nguyên với k6/backend; các số đo không thay thế nghiên cứu tài nguyên có lặp lại và điều kiện host được kiểm soát.

### Xóa đợt kiểm thử và khôi phục

Nút **Xóa đợt kiểm thử** nằm ngay cạnh **Chọn đợt kiểm thử** tại mục 03. Thao tác này **chuyển vào thùng rác**, không xóa vĩnh viễn:

1. Chọn một đợt đã hoàn tất do Dashboard tạo trong `dashboard/results/`. Nút chỉ sáng khi backend xác minh được quyền thao tác. Đổi dropdown không di chuyển hoặc xóa dữ liệu.
2. Nhấn **Xóa đợt kiểm thử**, kiểm tra đúng ID trong hộp thoại tiếng Việt. Nhấn **Hủy** để giữ nguyên, hoặc **Xác nhận xóa** để chuyển cả thư mục sang `dashboard/trash/<id>/`.
3. Sau khi thành công, danh sách/bảng/biểu đồ tự làm mới và chọn lại RUN ghim chính thức `web-full-2026-11-15T14-13-23-595Z-106fae93` nếu có trên máy. Đợt vừa chuyển không còn trong dropdown. Nếu lỗi kết nối lúc tải lại, nhấn **Làm mới kết quả**.
4. Mở **Thùng rác · khôi phục đợt kiểm thử**, chọn ID và nhấn **Khôi phục**. Thư mục quay lại `dashboard/results/<id>/`, được chọn để xem bảng/biểu đồ. Có nút **Làm mới thùng rác** khi một tab khác vừa thao tác.

Không có thao tác xóa vĩnh viễn hoặc tự dọn thùng rác. File JSON, log, metadata và nội dung thư mục được giữ nguyên byte; không sửa lại đường dẫn lưu trong metadata khi chuyển vào thùng rác. Bộ đọc kết quả sử dụng vị trí file thực tế sau khôi phục. Thư mục `trash/` được ignore Git giống `results/`.

**Quyền và điều kiện:**

- Luôn bảo vệ `benchmark/results/`, đợt chính thức, `legacy-original`, `legacy-v2`, kể cả khi ID đó xuất hiện trong thư mục Dashboard. Không dùng riêng tiền tố `web-` làm bằng chứng.
- Backend xác minh ID, vị trí dưới root thực, metadata adapter (ID/thư mục gốc/script/hash/LB/workload/thông số), trạng thái success/failed có thời điểm kết thúc và dữ liệu từng bài đã đóng. Metadata cũ của Dashboard được hỗ trợ khi khớp đầy đủ; metadata không xác minh được sẽ bị từ chối, không tự sửa để mở quyền xóa.
- Chặn ID chứa đường dẫn, path traversal, symlink/junction ở root/đợt hoặc bên trong đợt; chặn thư mục có file `.tmp` đang ghi.
- Trong lúc job chạy, kiểm tra điều kiện hoặc giữ khóa `.benchmark.lock`, không cho chuyển/khôi phục. Thao tác quản lý cũng dùng cùng khóa với runner để tránh đang ghi dữ liệu. Metadata còn running hoặc chưa có thời điểm kết thúc luôn bị từ chối, kể cả sau khi server khởi động lại.
- Nếu thư mục đích đã tồn tại, từ chối để tránh ghi đè. Không tự gộp dữ liệu hoặc đổi ID. Nếu hệ điều hành không cho rename, trả lỗi và giữ dữ liệu ở nguồn; không chuyển sang phương án copy rồi xóa.
- Thùng rác chỉ liệt kê các đợt xác minh được; thư mục lạ/metadata hỏng không có nút khôi phục. Nếu root bị di chuyển thủ công hoặc có job bị ngắt cứng, cần kiểm tra thủ công; Dashboard không tự sửa/xóa dữ liệu đó.

API chỉ nhận `{id, confirmed:true}` qua POST `/api/results/trash` hoặc `/api/results/restore`, cùng Origin và header `X-Dashboard-Action: results`. GET `/api/results/trash` đọc danh sách. Không nhận đường dẫn hoặc shell command từ frontend. Những kiểm tra này bảo vệ thao tác qua Dashboard; không thay thế quyền truy cập hệ thống tệp đối với người dùng hoặc phần mềm khác sửa trực tiếp thư mục trong lúc thao tác.

- Chọn **Chọn đợt kiểm thử** và **Chọn loại kiểm thử**: REST API, Keep-Alive ON/OFF, HTTP/2, gRPC Unary.
- RUN ghim chính thức mới luôn đứng đầu và là lựa chọn mặc định khi mở trang. `run-20261108-214448-206-b8432507` (08/11/2026) là RUN lịch sử vẫn được bảo vệ và xem bình thường. Các RUN còn lại giữ thứ tự ưu tiên đủ 15 PASS rồi mã đợt. Nguồn số liệu là JSON k6 và `runs.json`; không parse bảng Markdown đã làm tròn.
- Mỗi thư mục đợt chạy được tách riêng. File cũ ở gốc tách theo hậu tố (original, v2), có cảnh báo không đủ metadata xác nhận cùng điều kiện; không ghép vào đợt chính thức. Smoke trực tiếp backend không đưa vào so sánh ba LB.
- Đọc k6 legacy (`metrics.<name>`) và schema có `values`. HTTP dùng `http_reqs`, `http_req_duration`; gRPC dùng `unary_requests`, `grpc_req_duration`. gRPC/HTTP2 dùng `workload_errors`; REST/Keep-Alive dùng `http_req_failed`. Giá trị gốc là fraction, giao diện nhân 100 để hiển thị %; CSV giữ fraction và ghi rõ tên cột.
- Requests và Checks là hai cột riêng; Checks = passes + fails, có thể nhiều check/request. Thiếu chỉ số hiển thị N/A, không nội suy. JSON lỗi được cảnh báo, không làm sập server.
- PASS cần bằng chứng exit code 0 trong `runs.json`, số requests > 0, checks passes > 0/fails = 0, error rate = 0 và không threshold thất bại. FAIL khi có lỗi rõ ràng; thiếu bằng chứng hiển thị N/A. Đây là kiểm tra kết quả workload, không xác nhận mọi cấu hình hoặc công bằng tài nguyên host.
- Bốn biểu đồ cập nhật theo cùng lựa chọn; zero hiển thị 0 và thanh rỗng, thiếu dữ liệu hiển thị N/A. Thanh được chuẩn hóa theo giá trị lớn nhất của từng chỉ số. Không dùng FAIL để xếp hạng.
- Dòng **Historical benchmark results — Not a live measurement.** phân biệt dữ liệu lịch sử với demo trực tiếp. Nguồn đầy đủ có trong phần mở rộng cuối bảng và CSV.
- Keep-Alive có sleep 50 ms; không so RPS chéo workload để kết luận giao thức tốt hơn. Một vòng 30 giây chưa đủ kết luận tổng quát.

## Cập nhật và xuất dữ liệu

Khi bạn chủ động chạy benchmark bằng công cụ hiện có, hãy giữ nguyên thư mục cũ và dùng thư mục mới do runner tạo. Nhấn **Làm mới kết quả** sau khi runner hoàn tất: server đọc lại ổ đĩa, giữ lựa chọn đợt hiện tại nếu vẫn tồn tại. Chọn đợt mới trong danh sách để xem. Không cần khởi động lại Dashboard.

Nhấn **Xuất CSV** để tải ba dòng LB từ chính dữ liệu đang hiển thị của đợt/workload đang chọn, gồm throughput, latency, error fraction, requests, checks, trạng thái và nguồn. CSV UTF-8 BOM phù hợp Excel Windows. Trong lúc benchmark đang ghi file, dữ liệu có thể chưa đầy đủ; đợi runner hoàn tất rồi Refresh Results và xuất. API `/api/export.csv` cũng hỗ trợ xuất dữ liệu mới đọc từ ổ đĩa cho công cụ bên ngoài.

## Xử lý lỗi

- `node` không được nhận diện: cài Node.js >=20 và mở lại PowerShell.
- `EADDRINUSE`: đặt `DASHBOARD_PORT=5174` như trên. Các cổng LB/backend/TLS được bảo vệ khỏi dùng làm cổng Dashboard.
- LB Offline hoặc ECONNREFUSED: kiểm tra hệ thống Docker đang chạy theo quy trình dự án; Dashboard không tự bật Docker hoặc sửa cấu hình. Kiểm tra đọc an toàn: `docker compose ps -a` và `docker compose logs --tail 50` nếu Docker CLI có sẵn.
- Unknown: di chuột lên trạng thái để xem lỗi; HTTP 200 với JSON không hợp lệ không được tính Online.
- Không có kết quả: kiểm tra `benchmark/results/`, tên file `<nginx|haproxy|envoy>-<workload>.json`; thư mục con trực tiếp là từng đợt. File gốc hỗ trợ hậu tố `-v<number>`. Dashboard không đọc đường dẫn tuyệt đối trong metadata và không theo symlink ra ngoài.
- N/A/PASS thiếu: xem nguồn và `runs.json`; không sửa JSON lịch sử để thay đổi trạng thái.
- HTTP 403 khi POST: mở trực tiếp URL localhost của Dashboard; request cần cùng Origin và header hành động do giao diện gửi (`demo` cho demo, `benchmark` cho chạy/dừng k6). API chạy k6 còn yêu cầu JSON chứa xác nhận rõ ràng.

## Kiểm thử

```powershell
node --check .\dashboard\server.cjs
node --check .\dashboard\results.cjs
node --check .\dashboard\public\app.js
node --check .\dashboard\public\demo.js
node --check .\dashboard\public\benchmark.js
node --check .\dashboard\benchmark-runner.cjs
node --check .\dashboard\result-storage.cjs
node --check .\dashboard\public\results-management.js
node --check .\dashboard\resource-monitor.cjs
node --check .\dashboard\public\resources.js
node --check .\dashboard\full-benchmark-runner.cjs
node --check .\dashboard\full-run-schema.cjs
node --test .\dashboard\test.cjs .\dashboard\benchmark.test.cjs .\dashboard\result-storage.test.cjs .\dashboard\resource-monitor.test.cjs .\dashboard\full-benchmark.test.cjs
# Hoac chay toan bo:
npm.cmd --prefix .\dashboard test
git diff --name-status
git status --short
```

Bộ kiểm thử trước phần thùng rác có 19 test: giữ nguyên 11 test cũ cho trạng thái/demo/benchmark lịch sử/biểu đồ/CSV, thêm 8 test adapter và API chạy k6. Các test adapter dùng tiến trình Node giả lập k6 và sao chép JSON lịch sử vào thư mục tạm có nhãn fixture, không tạo số liệu mới và không chạy k6 thật. Bao gồm thiếu k6, offline, chống chạy trùng cùng/khác Dashboard, JSON lỗi, exit code khác 0, timeout, dừng job, không ghi đè và tự chọn bảng/biểu đồ của đợt vừa chạy. Test demo cũ có gửi HTTP demo thật tới LB; không phải benchmark. Test offline dùng một cổng loopback thực đã đóng; không dừng LB. Xem `dashboard/TEST-REPORT.md` để biết kết quả kiểm tra trong lần triển khai.

Bổ sung 8 test quản lý thùng rác, tổng cộng **27 test**: chuyển/khôi phục và hash file, ID bảo vệ, nguồn metadata, job đang chạy, khóa ghi, path traversal, symlink/junction, trùng đích, API/xác nhận và cập nhật bảng/biểu đồ. Các test này chỉ dùng `dashboard/test-trash-*/` riêng biệt, không chuyển hoặc xóa benchmark thật. Thư mục fixture được giữ lại để đối chiếu, được ignore Git và không hiện trong danh sách kết quả; không tự dọn trong quá trình kiểm thử.

Bộ hiện tại có **38 test**, gồm 27 test trên và 11 test CPU/RAM. Test tài nguyên dùng Docker API/k6 giả lập riêng, kiểm tra CPU >100%, hai loại cgroup, cache thiếu, offline/404/JSON lỗi/timeout, dừng sampler, ba bài tuần tự, lưu/đọc file, PASS/FAIL không bị ảnh hưởng, không ghi đè, thùng rác/khôi phục và render giao diện. Không lấy mẫu Docker thật hoặc chạy benchmark thật trong các test này.

Sau khi thêm FULL RUN, tổng cộng **45 test**: thêm 7 test full-suite về preflight, đủ 15 bài tuần tự, hai lượt mới không ghi đè, tài nguyên riêng từng bài, lỗi/hủy/timeout, khóa chung với web, API/CSV, trash/restore và lọc biểu đồ tài nguyên theo workload. Các bài k6 full-suite trong test đều là tiến trình Node fixture sao chép summary lịch sử vào thư mục test riêng, không chạy k6 thật.

Bộ hiện tại có **50 test**, thêm 5 test ghim/bảo vệ: thứ tự, mặc định/nhãn, tooltip/nút disabled, API từ chối kể cả ID khác hoa/thường, RUN thử nghiệm vẫn thao tác được và dữ liệu RUN thật chỉ được đọc để đối chiếu. Chạy `npm.cmd --prefix .\dashboard test` để chạy đầy đủ. Các kiểm thử RUN lịch sử tìm đúng ID thay vì giả định luôn nằm đầu danh sách.
