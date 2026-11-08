# Kết quả chạy thực tế

Số liệu chỉ thuộc lần chạy trong thư mục này. FAIL không được dùng để xếp hạng hiệu năng.

| LB | Workload | Trạng thái | Requests | RPS | Avg ms | p90 ms | p95 ms | Error rate |
|---|---|---|---:|---:|---:|---:|---:|---:|
| direct-backend-1 | grpc | PASS | 5194 | 2595.178 | 0.650 | 1.068 | 1.186 | 0.000 |
| direct-backend-1 | keepalive-off | PASS | 76 | 37.991 | 0.833 | 1.367 | 1.473 | 0.000 |
| direct-backend-1 | keepalive-on | PASS | 78 | 38.267 | 0.678 | 1.026 | 1.082 | 0.000 |
| direct-backend-1 | rest | PASS | 8090 | 4039.130 | 0.426 | 0.756 | 1.158 | 0.000 |
| direct-backend-2 | grpc | PASS | 5194 | 2595.763 | 0.660 | 1.088 | 1.208 | 0.000 |
| direct-backend-2 | keepalive-off | PASS | 76 | 37.934 | 0.866 | 1.373 | 1.481 | 0.000 |
| direct-backend-2 | keepalive-on | PASS | 78 | 38.403 | 0.558 | 0.990 | 1.121 | 0.000 |
| direct-backend-2 | rest | PASS | 6796 | 3396.497 | 0.514 | 1.081 | 1.296 | 0.000 |

gRPC latency là grpc_req_duration; lỗi kết nối được tính vào workload_errors và unary_requests nhưng có thể không có mẫu latency.
Không so sánh trực tiếp HTTP/2 REST và gRPC: payload và đường xử lý khác nhau. RPS là throughput workload thực tế, bao gồm các lần thử thất bại.
Keep-Alive cũ có sleep 50 ms; hai workload mới không có sleep. Chạy tuần tự, không có warm-up tách riêng; TLS handshake đầu tiên thuộc lần chạy.
Client, LB và backend có thể cùng máy; cần chạy lặp, đổi thứ tự LB và ghi tài nguyên trước khi rút ra kết luận Chương 4.