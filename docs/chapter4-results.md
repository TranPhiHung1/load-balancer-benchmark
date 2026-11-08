# Tổng hợp phục vụ Chương 4

Nguồn chính thức: [benchmark/results/run-20261108-214448-206-b8432507](../benchmark/results/run-20261108-214448-206-b8432507/chapter4-results.md). 15/15 lượt exit code 0, checks không thất bại, tỷ lệ lỗi 0; 10 VUs/30 giây mỗi lượt. Kiểm tra từ bằng chứng có sẵn, không chạy lại benchmark trong bước lưu tiến độ.

## Benchmark chính thức qua Load Balancer

Số liệu chỉ thuộc lần chạy trong thư mục này. FAIL không được dùng để xếp hạng hiệu năng.

| LB | Workload | Trạng thái | Requests | RPS | Avg ms | p90 ms | p95 ms | Error rate |
|---|---|---|---:|---:|---:|---:|---:|---:|
| nginx | http2 | PASS | 132808 | 4426.649 | 2.105 | 2.773 | 3.330 | 0.000 |
| nginx | grpc | PASS | 84291 | 2809.435 | 3.355 | 4.402 | 4.989 | 0.000 |
| nginx | rest | PASS | 132126 | 4403.789 | 2.154 | 2.853 | 3.447 | 0.000 |
| nginx | keepalive-on | PASS | 5620 | 187.011 | 2.593 | 3.326 | 3.667 | 0.000 |
| nginx | keepalive-off | PASS | 5464 | 181.839 | 3.850 | 4.732 | 5.324 | 0.000 |
| haproxy | http2 | PASS | 121829 | 4060.734 | 2.295 | 3.151 | 3.751 | 0.000 |
| haproxy | grpc | PASS | 71036 | 2367.482 | 3.973 | 5.649 | 6.525 | 0.000 |
| haproxy | rest | PASS | 123860 | 4128.233 | 2.295 | 3.237 | 3.834 | 0.000 |
| haproxy | keepalive-on | PASS | 5650 | 188.129 | 2.569 | 3.391 | 3.781 | 0.000 |
| haproxy | keepalive-off | PASS | 5432 | 180.828 | 4.273 | 5.259 | 5.945 | 0.000 |
| envoy | http2 | PASS | 120903 | 4029.683 | 2.313 | 2.955 | 3.496 | 0.000 |
| envoy | grpc | PASS | 72852 | 2428.090 | 3.894 | 5.187 | 5.715 | 0.000 |
| envoy | rest | PASS | 129899 | 4329.530 | 2.186 | 2.830 | 3.311 | 0.000 |
| envoy | keepalive-on | PASS | 5610 | 186.765 | 2.960 | 3.711 | 4.081 | 0.000 |
| envoy | keepalive-off | PASS | 5398 | 179.679 | 4.397 | 5.388 | 6.362 | 0.000 |

gRPC latency là grpc_req_duration; lỗi kết nối được tính vào workload_errors và unary_requests nhưng có thể không có mẫu latency.
Không so sánh trực tiếp HTTP/2 REST và gRPC: payload và đường xử lý khác nhau. RPS là throughput workload thực tế, bao gồm các lần thử thất bại.
Keep-Alive cũ có sleep 50 ms; hai workload mới không có sleep. Chạy tuần tự, không có warm-up tách riêng; TLS handshake đầu tiên thuộc lần chạy.
Client, LB và backend có thể cùng máy; cần chạy lặp, đổi thứ tự LB và ghi tài nguyên trước khi rút ra kết luận Chương 4.

## Bằng chứng smoke trực tiếp backend

Nguồn: benchmark/results/local-2026-11-08T14-39-15-374Z. Chạy thật ngày 08/11/2026, 2 VUs/2 giây mỗi lượt. gRPC dùng h2c trực tiếp và tắt threshold phân phối hai backend; không qua LB hoặc TLS. REST/Keep-Alive dùng nguyên script cũ.

| Backend | Workload | Requests | RPS | Avg ms | p90 ms | p95 ms | Error rate |
|---|---|---:|---:|---:|---:|---:|---:|
| backend-1 | grpc | 5194 | 2595.178 | 0.650 | 1.068 | 1.186 | 0 |
| backend-1 | keepalive-off | 76 | 37.991 | 0.833 | 1.367 | 1.473 | 0 |
| backend-1 | keepalive-on | 78 | 38.267 | 0.678 | 1.026 | 1.082 | 0 |
| backend-1 | rest | 8090 | 4039.130 | 0.426 | 0.756 | 1.158 | 0 |
| backend-2 | grpc | 5194 | 2595.763 | 0.660 | 1.088 | 1.208 | 0 |
| backend-2 | keepalive-off | 76 | 37.934 | 0.866 | 1.373 | 1.481 | 0 |
| backend-2 | keepalive-on | 78 | 38.403 | 0.558 | 0.990 | 1.121 | 0 |
| backend-2 | rest | 6796 | 3396.497 | 0.514 | 1.081 | 1.296 | 0 |

Các checks đều không thất bại; thêm 40 RPC/backend bằng grpc-js xác nhận backend identity. Đây là kiểm tra chức năng ngắn, không phải số đo hiệu năng dùng để kết luận đồ án.

## Cách điền số liệu chính thức

Chạy benchmark/run.ps1 trên máy có Docker; mỗi thư mục run mới chứa chapter4-results.md, summary JSON, console log và runs.json. Chỉ dùng lượt PASS, lưu cả lượt FAIL để giải thích. Ghi version/digest, tài nguyên host, thứ tự và số lần lặp. So sánh các LB trong cùng workload; không kết luận HTTP/2 REST tốt hơn/kém hơn gRPC chỉ từ RPS.