# Tự phục hồi DSH và Cloudflare Tunnel

Áp dụng cho Railway service DSH đang dùng bộ khởi động context-auto và bản sửa
Safari auth. Không thay tài khoản, lịch sử, model hoặc cài đặt token.

- Railway: restartPolicyType ALWAYS, startup.sh ở /data/plugins/dsh-reliability-20261104.
- keepalive.py chạy lại DSH stack sau mọi mã thoát, kể cả 0; chờ 2–30 giây
  khi lỗi lặp lại. SIGTERM/SIGINT từ thao tác dừng dịch vụ kết thúc vòng lặp.
- Cloudflare có vòng giám sát riêng; tunnel thoát sẽ tự chạy lại mà không dừng DSH.
- Khi DSH stack thoát, dọn các tiến trình con cũ trước khi khởi động lại để
  tránh xung đột cổng và mất khả năng đăng nhập. Authgate cũng được giám sát.
- apply.py đồng bộ plugin media từ /data/plugins/dsh-media vào đường dẫn /opt
  thực sự được DSH nạp, gồm cả khai báo và mã giao diện. Volume giữ bản này qua deploy.
- Chuỗi context-auto → Safari auth → entrypoint gốc vẫn giữ nguyên.

Không vô hiệu hóa thao tác Stop có chủ đích từ Railway; cần bấm Start/Restart
trên Railway sau khi chủ tài khoản dừng dịch vụ thủ công.

Kiểm thử Linux: python3 test_reliability.py. Bao phủ thoát 0, thoát khác 0,
kill tiến trình con, dừng supervisor và áp dụng bản vá nhiều lần.
