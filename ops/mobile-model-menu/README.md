# Menu model trên điện thoại

Bản vá cho DSH `0.2.1-rc.5`, triển khai 04/11/2026.

Ở phiên có model đã chọn, mở Model tự focus ô tìm kiếm. Safari bật bàn phím
và che danh sách vì menu dùng chiều cao layout viewport. Người dùng khó nhìn
và khó chọn model dù thao tác chọn ở máy chủ vẫn hoạt động.

- Màn hình hẹp hoặc thiết bị cảm ứng mở danh sách và focus model hiện tại.
  Chạm ô tìm kiếm mới bật bàn phím. Máy tính vẫn tự focus tìm kiếm.
- Menu điện thoại dùng chiều rộng còn trống, hàng chọn tối thiểu 44px.
  Ô tìm kiếm 16px tránh Safari tự zoom.
- Vị trí và chiều cao theo `visualViewport`, cập nhật khi bàn phím hoặc viewport
  di chuyển. Danh sách vẫn cuộn được khi chiều cao giảm.
- Không đổi model, mức suy luận hay lịch sử. Đổi model khi đang chạy có hiệu
  lực ở yêu cầu tiếp theo.

`patch-client.mjs` kiểm tra phiên bản, SHA256 gói gốc, từng điểm vá và thay đổi
ngoài dự kiến trước khi ghi. Giữ bản sao `client.js.before-mobile-model-menu`.
Chạy lại không thay đổi kết quả. HMR phục vụ bản mới mà không khởi động lại DSH;
trình duyệt đang mở có thể cần tải lại trang.

Trong Railway, script nằm tại
`/data/plugins/dsh-mobile-model-menu-20261104/patch-client.mjs` và được gọi từ
bộ khởi động reliability trước chuỗi context-auto/Safari hiện có.

Kiểm thử hình học menu (điện thoại, bàn phím, viewport có offset, máy tính):

```powershell
node --test ops/mobile-model-menu/test-menu.mjs
```

Đặt `DSH_MODEL_MENU_FIXTURE` tới gói `client.js` gốc nếu cần chạy thêm kiểm thử
parse bản vá, tính lặp lại và từ chối thay đổi đồng thời. Fixture không được
đưa vào repo. Đã chạy cả 4 kiểm thử với gói thực tế, kiểm tra UI 390px và desktop.
Chưa kiểm tra bàn phím Safari trên iPhone thật.

Phần code diff tự bung đã tắt bằng cấu hình plugin `dsh-inline-diff` trên web.
Các thao tác đọc/sửa file trở lại hàng thu gọn; bấm để mở chi tiết.
