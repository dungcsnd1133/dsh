# dsh-mobile-ux

Bản vá lớp phủ cho shell web của DSH trên điện thoại. **Không sửa bundle** —
mọi thứ là CSS và JS chèn lúc chạy, nên nâng cấp `dsh` không làm mất.

## Vì sao cần

Đo trên viewport 390×844 và 320×844:

| Vấn đề | Bằng chứng |
|---|---|
| Nút đóng Settings quá nhỏ | `_close_o6lrb_87` = **28×28px**, `_close_19zw2_37` = **36×36px** (chuẩn chạm 44px) |
| Tab tràn màn hình | 320px: tab thứ 3 bị cắt giữa |
| F5 mất chỗ đang xem | Shell **không có router**: 0 lần `pushState`, 0 `location.hash`, 0 `popstate` |
| Nút trong shell thấp | 20–36px |

## Sửa gì

1. Hai nút đóng lên **44×44px** (icon giữ nguyên vị trí, chỉ hộp chạm to ra)
2. Hàng tab **cuộn ngang** thay vì tràn
3. Mọi nút trong shell **≥44px** trên thiết bị cảm ứng
4. Dialog Settings **cuộn được** khi màn hình thấp
5. `input`/`textarea` **≥16px** để iOS không tự phóng to
6. **Nhớ chỗ đang xem**: mở Settings → tab nào thì F5 xong tự mở lại đúng tab đó (chỉ nhớ 30 phút, chỉ phục hồi một lần)

## Cài

```yaml
- id: dsh-mobile-ux
  name: '@local/dsh-mobile-ux'
```

rồi thêm `@local/dsh-mobile-ux/client.js` vào bundle client của profile.

## Hạn chế đã biết

Không thể thêm route thật: URL vẫn là `/`. Plugin **mở lại panel** sau khi tải
lại, không phải khôi phục URL — nên nút Back của trình duyệt vẫn không quay lại
được panel trước đó.
