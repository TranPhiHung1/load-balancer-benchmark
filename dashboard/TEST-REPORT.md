# Báo cáo kiểm tra Dashboard

## Ghim và bảo vệ FULL RUN chính thức — 15/11/2026

RUN: **web-full-2026-11-15T14-13-23-595Z-106fae93**. Đọc dữ liệu sẵn có xác nhận 15/15 hàng PASS, 15 measurement CPU/RAM đúng LB/workload, mỗi measurement có 30 mẫu hợp lệ. Không sửa nội dung, ID hoặc cấu trúc file kết quả.

Chính sách riêng ghim RUN đầu danh sách và đặt defaultBatchId; frontend dùng lựa chọn mặc định khi mở trang nhưng vẫn giữ lựa chọn thủ công khi refresh. Nhãn 📌 RUN chính thức · 15/15 PASS · CPU/RAM xuất hiện trong dropdown và mô tả. Nút xóa bị disabled, CSS xám/mờ và tooltip đúng yêu cầu. Chính sách server khóa ID không phân biệt hoa/thường trước thao tác filesystem, từ chối cả trash và restore. Không có permanent delete/auto cleanup. Runner/web benchmark, JSON k6, CPU/RAM và các biểu đồ không được chỉnh sửa; cơ chế tạo ID/thư mục mới của runner giữ nguyên, không nhận ID đích để overwrite dữ liệu cũ.

### Kiểm tra đã thực thi

- Cú pháp JavaScript các file mới/sửa: PASS.
- **50/50 unit test PASS**, gồm đủ 45 test trước và 5 test chính sách mới. Test cũ cho RUN lịch sử vẫn đối chiếu đủ 15 JSON và CSV/đồ thị, đổi truy xuất sang tìm đúng ID thay cho giả định index 0.
- Test ưu tiên RUN ghim ngay cả trước một RUN fixture mới hơn và complete; kiểm tra default/nhãn và fallback khi không có RUN ghim.
- Test đọc RUN thật chỉ đọc; không chạy benchmark. Kiểm tra frontend bằng VM: mặc định/reload chọn đúng RUN, label, nút disabled và tooltip; chọn RUN thử nghiệm nút hoạt động lại, refresh giữ lựa chọn, không có POST tự động.
- Test API trash/restore HTTP 403 khi bypass UI; test ID hoa/thường. Chỉ dùng store filesystem trỏ thư mục `dashboard/test-trash-pin-*` với sentinel giả, không POST thao tác vào dữ liệu thật. Các sentinel được giữ nguyên; RUN thử nghiệm fixture vẫn trash/restore bình thường.
- Server kiểm tra riêng trên 127.0.0.1:5178: GET `/api/results` trả đúng defaultBatchId, vị trí đầu, pinned/label, canTrash false và reason đúng. Không chạy benchmark hoặc gửi POST thao tác dữ liệu thật.
- SHA-256 đối chiếu **137 file kết quả/thùng rác, gồm 34 file của RUN ghim: 0 thay đổi**, baseline `pinned-preservation-baseline.json`. Git diff check PASS, diff name-status rỗng, status vẫn chỉ `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`. Không commit/push.

### File

Thêm `dashboard/benchmark-policy.cjs`, `benchmark-policy.test.cjs`, `pinned-preservation-baseline.json`. Sửa `dashboard/results.cjs`, `result-storage.cjs`, `public/app.js`, `public/results-management.js`, `public/style.css`, `test.cjs`, `package.json`, `TEST-REPORT.md` và `docs/DASHBOARD-GUIDE.md`. Không sửa server.cjs, các runner, module/biểu đồ tài nguyên, Compose/LB/backend/k6/cổng.

Giao diện được kiểm tra bằng VM/HTTP, chưa kiểm tra trực quan hoặc click trên trình duyệt thật. Server kiểm tra riêng được dừng sau xác minh, không can thiệp tiến trình Dashboard khác. Cần khởi động lại Dashboard đang dùng để nạp chính sách server mới.

## FULL RUN PowerShell 15 bài + CPU/RAM — 15/11/2026

### Kết quả và phạm vi

Thêm runner CLI độc lập `run-full-benchmark.ps1` → `full-benchmark-runner.cjs`. Tái sử dụng `findK6`, `scriptConfig`, `argumentsFor`, `checkTarget`, `cleanEnvironment`, `normalize` và `createResourceMonitor`; **không sửa dashboard/benchmark-runner.cjs, server.cjs hoặc benchmark/run.ps1**. Kế hoạch giữ thứ tự đợt chính thức: Nginx/HAProxy/Envoy, mỗi LB HTTP2/gRPC/REST/Keep-Alive ON/OFF, 15 bài tuần tự.

Kiểm tra trước tải gồm k6/version, Docker API cục bộ, đúng 5 container running/không paused/restarting, các endpoint và đọc Stats hợp lệ của ba LB. HTTP2/gRPC preflight chỉ xác minh listener TLS/ALPN theo hàm hiện có; checks của k6 xác minh payload/giao thức/RPC. `-CheckOnly` không tạo RUN hoặc spawn bài tải. Khi chạy cần nhập RUN, dùng khóa chung và thư mục ID mới; không overwrite/merge đợt cũ.

Lưu checkpoint JSON/log k6, runs, metadata (kế hoạch/thông số/hash/image ID/version), resource-metrics schema 2 (tối đa 15 khóa LB/workload) và k6-version.txt. Các file checkpoint chỉ cập nhật trong thư mục mới do chính tiến trình tạo. Có timeout, Ctrl+C hủy collector/child, lưu phần đã có và đánh dấu N/A cho bài chưa thực hiện. PASS/FAIL hiệu năng dùng tiêu chí cũ; resourceStatus riêng. FULL RUN chỉ success khi đủ 15 PASS và đủ dữ liệu tài nguyên hợp lệ.

### Kiểm thử đã chạy

- Parser PowerShell `[System.Management.Automation.Language.Parser]::ParseFile` cho script mới: **PASS**, không thực thi script.
- `node --check` runner, schema, tests và các module đã sửa: **PASS**.
- Toàn bộ **45/45 test PASS** (38 cũ + 7 full-suite), sau đó kiểm tra lại test full-suite khi bổ sung dòng thống kê console.
- Fixture full-suite là child process Node sao chép JSON k6 lịch sử vào `dashboard/test-job-full-*`, Docker API/counter giả lập ghi rõ TEST ONLY; không dùng dữ liệu đó như benchmark mới thật.
- Preflight từ chối Docker offline, thiếu backend/container, thiếu k6, endpoint lỗi và Stats bị từ chối trước khi spawn tải. Preflight thành công không tạo RUN hoặc dữ liệu.
- Lượt thành công lưu đủ 15 JSON + 15 log, metadata và 15 measurement đúng tuple/container, baseline/cửa sổ thời gian tách biệt; kiểm tra không chạy song song. Chạy fixture lần thứ hai tạo ID khác, file lượt trước không đổi.
- Bài k6 exit khác 0 giữ FAIL, tiếp tục các bài khác; lỗi tài nguyên không đổi PASS hiệu năng nhưng FULL RUN failed/resourceState error. Test hủy, timeout và khóa chặn web runner; không tiếp tục tạo bài sau khi hủy.
- Dashboard reader/API nhận đủ 15 hàng và tài nguyên schema 2; CSV vẫn 3 LB của workload chọn. UI model lọc đúng 3 measurement và 6 biểu đồ CPU/RAM cho mỗi workload, giữ 4 biểu đồ hiệu năng. Schema 1 của web tiếp tục qua test.
- Chuyển/khôi phục fixture FULL RUN giữ nguyên byte resource file. RUN chính thức cũ vẫn bị từ chối thao tác.
- SHA-256 đối chiếu **135 file gốc và 103 file trong benchmark/results, dashboard/results, dashboard/trash không thay đổi**; baseline riêng `full-run-preservation-baseline.json`. Không sửa/di chuyển/xóa đợt thật. Git diff check PASS, diff name-status rỗng, status vẫn `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`. Không commit/push.

### Chưa kiểm chứng

**Không chạy k6 thật, không chạy preflight Docker thật bằng runner mới**, đúng yêu cầu chờ người dùng xác nhận. Chưa kiểm chứng end-to-end PowerShell/k6/Docker hoặc Ctrl+C với k6 thật trên Windows; PowerShell chỉ parse, vòng đời process/collector kiểm tra qua fixture. Không có kiểm thử click/screenshot mới; giao diện được kiểm tra qua VM và HTTP API fixture. Kết quả fixture không xuất hiện trong các thư mục benchmark thật. Khóa chung không ngăn lệnh k6 hoặc demo do người dùng chạy ngoài runner; hard kill/mất điện có thể còn khóa/file đang ghi.

### File

Thêm `dashboard/run-full-benchmark.ps1`, `full-benchmark-runner.cjs`, `full-run-schema.cjs`, `full-benchmark.test.cjs`, `full-run-preservation-baseline.json`.

Sửa `dashboard/resource-monitor.cjs` (thêm inspect GET và hỗ trợ schema 2; giữ hành vi monitor schema 1), `resource-monitor.test.cjs`, `results.cjs`, `result-storage.cjs` (nhận diện metadata full-suite riêng), `public/resources.js` (nhãn thiếu dữ liệu N/A), `package.json`, `TEST-REPORT.md`, `docs/DASHBOARD-GUIDE.md`. Không sửa luồng benchmark web đang chạy, thuật toán, cổng, backend, Compose hoặc script k6.

## CPU/RAM Monitor — 15/11/2026

### Phạm vi và bảo toàn

Đã tạm dừng hướng bổ sung Weighted Round Robin, Least Connections/Least Request, IP Hash. Công việc trước chỉ phân tích, **không có file/container demo thuật toán đang triển khai**; `dashboard/algorithm-demo` không tồn tại. Không hoàn tác hoặc xóa thay đổi cũ. Git trước/sau vẫn là `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`.

Module mới dùng Docker Engine API cục bộ cho đúng `nginx-lb`, `haproxy-lb`, `envoy-lb` theo Compose, không gọi shell hoặc tự khởi động Docker. Thu thập khoảng mỗi giây từ lúc k6 spawn tới lúc đóng/dừng/timeout; chia cửa sổ theo từng bài. CPU có thể >100%; RAM MiB theo usage trừ inactive file cache khi có, ưu tiên total_inactive_file cho cgroup v1, đánh dấu raw usage nếu thiếu cache. Lỗi là N/A, không tự gán bằng 0. Khoảng đo bao gồm khởi tạo/kết thúc tiến trình k6, chưa tách riêng pha VUs ổn định.

Thêm `resource-metrics.json` chỉ trong thư mục job mới, tạo `wx` không ghi đè; không thay JSON k6 hay PASS/FAIL. Lỗi thu thập/lưu tài nguyên được tách khỏi kết quả hiệu năng. Dữ liệu đi cùng thư mục khi trash/restore. Các đợt cũ không có tài nguyên hiển thị “Chưa thu thập dữ liệu tài nguyên”. Hai biểu đồ CPU/RAM riêng không sửa bảng/bốn biểu đồ/CSV hiệu năng cũ.

### Kiểm thử đã thực thi

- Kiểm tra cú pháp JavaScript của monitor, test mới, runner, results, server, app/benchmark/resources frontend: PASS.
- Toàn bộ **38/38 test PASS**, gồm 27 test cũ và 11 test mới. Test benchmark cũ chỉ thêm factory monitor offline giả lập để không truy cập Docker thật, giữ nguyên các khẳng định kiểm thử trước đó.
- Test mới xác nhận công thức CPU 300%, CPU thiếu baseline = null, RAM cgroup v1/v2/thiếu cache, counter lỗi; API Docker giả lập có version negotiation, tên container cố định, 404, JSON lỗi, offline và timeout; sampler không chạy trước start, không ghi sau stop, hủy request đang chờ.
- Job k6 giả lập chạy ba LB tuần tự có cửa sổ/mẫu đúng container riêng, lưu/đọc schema và thống kê. Docker offline/khởi tạo monitor lỗi không làm thay đổi benchmark PASS. JSON tài nguyên hỏng/schema hỏng không làm đổi metric row; resource file đã tồn tại không bị ghi đè và chỉ báo resourceError.
- Dừng k6 giả lập ngừng collector và giữ mẫu hợp lệ trong khoảng đo. Chuyển/khôi phục fixture giữ nguyên byte resource file và đọc lại đúng dữ liệu. Không trash/restore đợt thật trong phiên này.
- UI model (JavaScript VM) kiểm tra giá trị CPU >100, đơn vị MiB, N/A khi Docker lỗi, biểu đồ có khoảng trống thay vì nối số giả, chọn từng bài, dữ liệu lịch sử thiếu và không sửa nội dung bốn biểu đồ/bảng cũ.
- Server khởi động riêng tại **http://127.0.0.1:5177**. GET trang HTTP 200, có CPU/RAM Monitor; `/resources.js` HTTP 200; API benchmark trả `job:null,busy:false`. API kết quả có 3 nhóm lịch sử, không cảnh báo, 0 resource file được thêm vào dữ liệu cũ. Chỉ đọc các API trên; không chạy benchmark mới.
- SHA-256: **135 file gốc không đổi**; baseline mới đối chiếu **98 file thuộc benchmark/results, dashboard/results và dashboard/trash, không đổi**. `git diff --check` exit 0, `git diff --name-status` rỗng. Không commit/push, không sửa config LB/Compose/backend/k6/cổng.

### Docker thật và giới hạn

**Chưa kiểm chứng lấy mẫu CPU/RAM với Docker thật.** Docker CLI không có trong PATH; phép đọc `/version` qua named pipe bị môi trường từ chối `EPERM` tại `\\.\pipe\dockerDesktopLinuxEngine`. Không chạy bài kiểm thử tài nguyên thật hoặc k6 thật khi chưa có quyền truy cập và sự cho phép của người dùng. Các bài HTTP demo trong bộ hồi quy cũ là request thật, không phải benchmark k6 và không phải xác minh Docker resource API.

Browser tool vẫn trả `The browser access host is unavailable`, nên chưa có screenshot/kiểm tra trực quan hoặc click thật. Giao diện được kiểm tra qua HTML/HTTP và VM. Giới hạn thêm: Linux containers; không tự dùng Docker context từ xa; khoảng mẫu có jitter; CPU cần baseline; memory raw được ghi nhãn khi thiếu cache; trung bình theo mẫu và peak theo mẫu; kill cứng/mất điện có thể mất resource data chưa lưu. Server kiểm tra 5177 được dừng sau kiểm tra.

### File thay đổi

Thêm `dashboard/resource-monitor.cjs`, `resource-monitor.test.cjs`, `public/resources.js`, `resource-preservation-baseline.json`.

Sửa `dashboard/benchmark-runner.cjs`, `benchmark.test.cjs`, `results.cjs`, `server.cjs`, `package.json`, `public/index.html`, `public/app.js`, `public/benchmark.js`, `public/style.css`, `TEST-REPORT.md` và `docs/DASHBOARD-GUIDE.md`. Không sửa `demo.js`, `result-storage.cjs`, các cấu hình hệ thống hoặc dữ liệu đã có. Các dữ liệu fixture mới chỉ nằm trong thư mục test riêng được ignore.

## Quản lý đợt benchmark bằng thùng rác — 15/11/2026

**27/27 test PASS** khi chạy `node --test dashboard/test.cjs dashboard/benchmark.test.cjs dashboard/result-storage.test.cjs`. Giữ nguyên 19 test cũ; thêm 8 test quản lý dữ liệu. Cú pháp JavaScript của server, adapter, storage, test và các file frontend được kiểm tra thành công.

Các test mới chỉ dùng thư mục riêng `dashboard/test-trash-*`, giữ fixture sau test để đối chiếu, không tự dọn. JSON trong fixture là bản sao từ số liệu lịch sử, có log ghi rõ TEST FIXTURE; không sinh benchmark giả hoặc đưa fixture vào danh sách dữ liệu thật. Đã xác minh:

- Chuyển đợt vào thùng rác và khôi phục có hash toàn bộ file không đổi, đợt biến mất/xuất hiện đúng trong bộ đọc kết quả.
- Không dựa vào tiền tố web: metadata hợp lệ ở root đúng mới có quyền; hỗ trợ cả metadata Dashboard đời trước không có producer marker. Metadata nguồn khác, thiếu metadata, running, thiếu thời điểm kết thúc hoặc có file `.tmp` bị chặn.
- Từ chối đợt chính thức, hai legacy, ID lạ, đường dẫn tuyệt đối/tương đối, path traversal. Kiểm tra symlink/junction tại root, thư mục đợt, bên trong đợt và thư mục thùng rác đều bị từ chối; fixture ngoài vùng thao tác không đổi.
- Khóa active trong bộ nhớ và khóa `.benchmark.lock` chung với runner đều chặn thao tác khi benchmark đang chạy/ghi; không ghi đè khi đích đã có thư mục cùng ID.
- API yêu cầu cùng Origin, header hành động, JSON chỉ có ID và xác nhận. Test API chỉ thao tác fixture. UI model xác minh lịch sử bị vô hiệu hóa, Hủy không gửi POST, xác nhận chuyển xong chọn lại đợt chính thức và cập nhật bốn biểu đồ; khôi phục chọn lại fixture đúng số liệu.

Server kiểm tra chạy tại **127.0.0.1:5176**: GET trang HTTP 200 và có dialog mới. GET `/api/results` xác nhận 3 đợt Dashboard hiện có `canTrash:true`; đợt chính thức, legacy-original, legacy-v2 đều `canTrash:false`. GET thùng rác trả danh sách rỗng. Chỉ gọi GET trên server thực; **không gửi POST xóa/khôi phục hoặc chạy k6 với dữ liệu thật**.

Đối chiếu sau kiểm thử: **135 file gốc không đổi**, thêm baseline cho **12 file trong 3 đợt Dashboard thật, không đổi** (`trash-preservation-baseline.json`). Không di chuyển hay xóa đợt benchmark thật nào. `git diff --check` exit 0, `git diff --name-status` rỗng, Git vẫn chỉ có `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`. Không commit/push.

File thêm: `dashboard/result-storage.cjs`, `result-storage.test.cjs`, `public/results-management.js`, `trash-preservation-baseline.json`. File sửa: `dashboard/server.cjs`, `benchmark-runner.cjs` (marker nguồn cho các job mới), `package.json`, `.gitignore`, `public/index.html`, `public/app.js`, `public/benchmark.js`, `public/style.css`, `TEST-REPORT.md`, `docs/DASHBOARD-GUIDE.md`. Không sửa bộ đọc metric, script k6, cấu hình LB/backend/Compose hoặc các kết quả cũ.

**Giới hạn:** công cụ mở trình duyệt trả `The browser access host is unavailable`; chưa có screenshot hoặc kiểm tra click trực tiếp. Xác minh hành vi bằng HTTP và JavaScript VM. Không có xóa vĩnh viễn/tự dọn thùng rác; metadata không xác minh được, job bị ngắt chưa hoàn tất, symlink/junction hoặc xung đột đích cần kiểm tra thủ công. Khóa bảo vệ các tiến trình Dashboard dùng chung thư mục; không kiểm soát người dùng/phần mềm chỉnh filesystem trực tiếp đồng thời. Server kiểm tra riêng 5176 được dừng sau xác minh; không dừng tiến trình Dashboard khác.

## Chạy k6 từ giao diện — 15/11/2026

### Kết quả thực thi kiểm tra

- Đã đọc lại runner, bốn script benchmark, JSON/metadata gốc, server/results và các file giao diện. `Get-Command k6` tìm thấy **C:\Program Files\k6\k6.exe**. Chỉ kiểm tra PATH/file, không gọi `k6 run`.
- Kiểm tra cú pháp server, results, adapter, app/demo/benchmark frontend: PASS.
- `node --test dashboard/test.cjs dashboard/benchmark.test.cjs`: **19/19 PASS**, gồm toàn bộ 11 test cũ và 8 test mới. Test mới dùng child process Node `fixtures/mock-k6.cjs`, sao chép JSON đã có vào thư mục `dashboard/test-job-*` rồi xóa sau test; không chạy k6 thật và không đưa dữ liệu fixture vào `dashboard/results/` hoặc `benchmark/results/`.
- Đã kiểm tra đối số năm workload theo runner gốc; VUs/duration đọc được là **10/30s**. Kiểm tra log stdout/stderr, metadata, tuần tự ba LB, ID/thư mục mới không ghi đè lượt trước; kết quả một LB không lấy số của hai LB còn lại.
- Thiếu k6 hoặc preflight offline: không spawn, API trả 503. Thiếu xác nhận, JSON lỗi, shell command/URL/workload ngoài danh sách: bị chặn. Job song song cùng runner và runner khác dùng chung output root: bị chặn. Demo không chạy trong lúc benchmark chạy.
- JSON summary lỗi, exit code khác 0, timeout và dừng job đều không trở thành PASS. Kiểm tra dừng trước lúc spawn, ngừng LB tiếp theo, giải phóng khóa. UI model kiểm tra Hủy hộp xác nhận không gửi POST, polling cập nhật số bài/log/trạng thái và tự chọn đúng đợt/workload; bảng/biểu đồ có N/A cho LB không chạy.
- Server kiểm tra khởi động thành công trên **127.0.0.1:5175**. GET trang chính HTTP 200, có mục 04. `/api/benchmark/config` nhận diện k6 và năm workload 10 VUs/30s; `/api/benchmark/status` trả `job:null,busy:false`. `/api/results` vẫn có ba nhóm lịch sử, không cảnh báo. Mở trang/đọc các API này không chạy benchmark. `dashboard/results/` chưa được tạo sau kiểm tra vì chưa có job thật.
- Đối chiếu SHA-256 **135 file gốc: 0 thay đổi**. `git diff --check` exit 0, `git diff --name-status` rỗng, status vẫn chỉ `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`. Không commit/push.

### Phạm vi thay đổi lần này

Sửa `dashboard/server.cjs`, `results.cjs`, `package.json`, `public/app.js`, `public/index.html`, `public/style.css`, `TEST-REPORT.md` và `docs/DASHBOARD-GUIDE.md`. Thêm `dashboard/benchmark-runner.cjs`, `benchmark.test.cjs`, `fixtures/mock-k6.cjs`, `public/benchmark.js`, `.gitignore` cho dữ liệu runtime. Không thay `demo.js` hoặc bỏ kiểm thử cũ.

### Giới hạn

**Chưa chạy benchmark k6 thật**, đúng yêu cầu chưa được người dùng cho phép. Chưa xác minh tích hợp k6 thật end-to-end, hành vi dừng k6 thật trên Windows và xuất summary khi bị ngắt. Các bài HTTP demo của kiểm thử cũ vẫn chạy thật, không phải tải k6.

Thử mở trình duyệt nhận `The browser access host is unavailable`; chưa kiểm tra trực quan/click trực tiếp. Xác minh giao diện mới bằng HTTP, nguồn HTML và JavaScript VM. UI chỉ giữ job hiện tại của tiến trình Dashboard; kết quả vẫn tồn tại sau khi khởi động lại. Khi kill cứng/mất điện có thể còn khóa; hướng dẫn mô tả cách kiểm tra và gỡ khóa thủ công. Không thể ngăn k6 được khởi chạy bên ngoài Dashboard. Server kiểm tra 5175 được dừng sau xác minh.

## Nâng cấp giao diện và demo streaming — 15/11/2026

Đã thực thi lại kiểm tra cú pháp năm file JavaScript (`server.cjs`, `results.cjs`, `public/app.js`, `public/demo.js`, `test.cjs`): PASS. Bộ test sau nâng cấp **11/11 PASS**, giữ đủ 7 test ban đầu và thêm 4 test:

1. 10 yêu cầu thật tới Nginx ở nhịp Bình thường: 22 sự kiện start/request/result/done đúng thứ tự; phản hồi đầu đến trước khi lượt kết thúc, khoảng nghỉ trước request kế tiếp được kiểm tra. Cập nhật từng kết quả vào mô hình DOM kiểm tra tiến trình, đếm backend/lỗi, class hiệu ứng, lịch sử và đặt lại.
2. 20 yêu cầu thật qua streaming Envoy ở nhịp Nhanh; API cũ HAProxy vẫn trả đủ 10 rows. Server từ chối ba thuật toán chưa triển khai và tham số count/speed không hợp lệ; HTML có các lựa chọn disabled và nhãn tiếng Việt.
3. Dùng kết quả probe từ một cổng loopback thực đã đóng để kiểm tra hiển thị thất bại, tăng tiến trình và không cộng backend; chặn sự kiện trùng thứ tự và không cho frontend chạy thuật toán khác. Không dừng LB để thử offline toàn tuyến.
4. Kiểm tra khóa chung API cũ/mới, hủy kết nối streaming, ngừng các request tiếp theo và giải phóng khóa.

Server nâng cấp khởi động thành công tại **127.0.0.1:5174** vì cổng 5173 đang bận. Giữ nguyên tiến trình trên 5173. Kiểm tra HTTP bổ sung trên 5174: cả 5 thành phần Online; 10 request Nginx thành công, Backend 1/2 = 5/5, có đủ 22 sự kiện. Bằng chứng gốc trong `runtime-upgrade-check.json`; không thay file `runtime-check.json` của lần trước. Các con số phân phối chỉ là quan sát của mẫu kiểm tra đó.

Phần benchmark vẫn đọc cùng dữ liệu; 15 kết quả được đối chiếu lại với JSON gốc, năm workload/bốn biểu đồ và CSV vẫn qua test. Không sửa `results.cjs`, dữ liệu benchmark hoặc script k6. Không có tính năng Run Benchmark từ phiên bản trước và không thêm tính năng chạy benchmark.

Đối chiếu SHA-256 lần cuối: **135 file cũ, 0 thay đổi**. `git diff --check` exit 0, `git diff --name-status` rỗng; `git status --short` vẫn chỉ có `?? dashboard/` và `?? docs/DASHBOARD-GUIDE.md`. Không commit/push. Các file đã sửa trong lần nâng cấp: `dashboard/server.cjs`, `dashboard/public/index.html`, `dashboard/public/app.js`, `dashboard/public/style.css`, `dashboard/test.cjs`, `dashboard/TEST-REPORT.md`, `docs/DASHBOARD-GUIDE.md`. File mới: `dashboard/public/demo.js`, `dashboard/runtime-upgrade-check.json`.

**Giới hạn:** thử mở trang bằng công cụ trình duyệt vẫn nhận `The browser access host is unavailable`. Chưa kiểm tra trực quan bố cục/animation/responsive bằng trình duyệt thật. Kiểm tra hiệu ứng ở trên xác nhận class và trạng thái DOM bằng VM, không phải screenshot hoặc thao tác click thật. Chưa kiểm tra việc mất một LB đang hoạt động bằng cách dừng container. Server kiểm tra cổng 5174 được dừng khi hoàn tất; dùng hướng dẫn để khởi động bản nâng cấp.

## Kết quả phiên bản đầu (giữ lại)

Ngày 15/11/2026, môi trường Windows, Node.js v24.11.0. Không chạy k6, không dừng/khởi động lại container, không commit/push.

## Đã thực thi

- `node --check` cho `server.cjs`, `results.cjs`, `public/app.js`, `test.cjs`: exit 0.
- `node --test dashboard/test.cjs`: 7/7 PASS. Đối chiếu đủ 15 dòng chính thức với JSON gốc (RPS, total, avg, p95, error rate); schema legacy/values, thiếu dữ liệu, JSON hỏng, CSV của năm workload, endpoint đọc benchmark và CSV, chặn Host/Origin/URL tùy ý/đọc private key. Test render JavaScript kiểm tra bảng, bốn biểu đồ và CSV tải từ snapshot của cả năm workload, trường hợp N/A không tạo thanh số liệu giả.
- Server khởi động thành công tại `http://127.0.0.1:5173`; GET trang chính HTTP 200.
- `/api/status`: năm endpoint thực trả HTTP 200, nhận diện backend hợp lệ, trạng thái Online tại thời điểm kiểm tra.
- POST `/api/round-robin/nginx`, `/haproxy`, `/envoy`: mỗi API trả đúng 10 kết quả thật, đủ thứ tự, HTTP 200, backend identity và response time. Nginx: Backend 1/2 = 5/5; HAProxy = 5/5; Envoy = 4/6. Đây là mẫu trực tiếp, không phải benchmark mới và không đảm bảo các lượt sau phân phối giống nhau. Bằng chứng chưa làm tròn trong `runtime-check.json`.
- Offline: gọi probe tới một cổng loopback thực đã đóng, xác nhận status/backend null và lỗi kết nối rõ ràng. Không dừng LB để tạo sự cố; kịch bản ngắt một LB đang chạy chưa thử.
- `git diff --check`: exit 0; `git diff --name-status`: không có file tracked bị thay đổi. Git có cảnh báo chuyển LF/CRLF đối với tài liệu cũ khi Git chạm file lần sau; file không bị chỉnh sửa trong phiên này.
- SHA-256 đối chiếu 135 file tồn tại trước triển khai (ngoài `.git`, cache, node_modules và thư mục dashboard): không file nào thay đổi. Baseline nằm trong `preservation-baseline.json`. Bao gồm các cấu hình, code, benchmark/results, tài liệu cũ và tài liệu cá nhân trong phạm vi đã quét.

## Giới hạn xác minh

Công cụ mở trình duyệt trả `The browser access host is unavailable`. Chưa có screenshot QA hoặc kiểm thử click trực tiếp trên trình duyệt; render bảng/biểu đồ và Blob CSV được kiểm tra bằng JavaScript VM và HTTP API. Chưa kiểm tra thực tế trình duyệt responsive hoặc tải CSV bằng Excel. Không thử failover, TLS, HTTP/2/gRPC live vì ngoài luồng Dashboard REST; chỉ đọc benchmark lịch sử của các workload đó.

Không có chức năng yêu cầu nào bị bỏ khỏi phiên bản này; giới hạn trên là các bước chưa xác minh bằng UI/hệ thống thực. Server dùng Node.js built-in và biểu đồ HTML/CSS, không cần cài dependency hoặc kết nối CDN.
