# Kết quả chạy thực tế

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