# Khôi phục danh sách model trống trên DSH rc.5

Ngày 04/11/2026, model picker báo `No models available` và chat báo
`no adapter registered for provider "tlpro"` (`NO_ADAPTER`).

Log khởi động xác nhận plugin `@deepseek-ai/dsh-llm-pi-ai` thất bại vì
`providers.google.api: google-generative-ai` không thuộc danh sách protocol
override được schema rc.5 chấp nhận. Plugin không đăng ký được adapter nào,
khiến cả TLPRO lẫn Google biến mất khỏi danh sách.

Bỏ riêng trường `providers.google.api` để route Google dùng protocol của
provider có sẵn. Giữ nguyên models, thông tin auth, endpoint và các route khác.
Cấu hình đã sửa nằm trên volume tại
`/data/.dsh/profiles/superagent/cordis.patch.yml`.

Script có chế độ kiểm tra mặc định, `--apply` mới ghi. Nó dùng YAML AST để
giữ cấu trúc tài liệu, kiểm tra schema toàn bộ adapter trước khi lưu, phát
hiện thay đổi đồng thời và giữ backup tại `.before-google-api-repair`.
Không in cấu hình hay credentials.

```sh
node repair-google-api.mjs \
  --root /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules \
  --profile /data/.dsh/profiles/superagent/cordis.patch.yml --apply
```

Sau đó bật lại entry `include:llm-pi-ai` qua plugin manager để HMR nạp cấu
hình đã sửa. Trên production đã xác nhận `fiberPhase: active`, không restart.

Kiểm chứng: cấu hình cũ tái hiện chính xác lỗi schema; cấu hình mới hợp lệ;
so sánh sâu xác nhận toàn bộ provider settings giữ nguyên ngoài trường api
đã bỏ; chạy lại script không phát sinh thay đổi. UI đã có 7 model TLPRO và 2
model Google; đổi model ở phiên cũ thành công rồi khôi phục lựa chọn ban đầu.
Khung chat mới và menu ở màn hình 390px cũng hiển thị danh sách.
