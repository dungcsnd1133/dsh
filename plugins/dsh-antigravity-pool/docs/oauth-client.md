# OAuth client cho Antigravity: tìm và kiểm chứng

Antigravity (Google Cloud Code Assist) không có hệ thống tài khoản riêng. Nó
đăng nhập bằng Google OAuth, và **mọi yêu cầu OAuth đều cần một `client_id`** —
đó là thứ cho Google biết ứng dụng nào đang xin quyền.

Có hai đường lấy client:

| Cách | Việc phải làm | Hợp khi |
|---|---|---|
| **A. Client công khai của app Antigravity** | Không cần tạo gì, chỉ cần kiểm chứng | Dùng ngay, phần lớn trường hợp |
| **B. Tự tạo trên Google Cloud Console** | Tạo project + OAuth client | Muốn quota/redirect riêng, hoặc cách A bị Google chặn |

Cả hai đều dùng chung một quy trình đăng nhập trong plugin.

---

## A. Dùng client công khai của app Antigravity

### Vì sao có client này

App Antigravity là ứng dụng desktop. Khi bạn cài nó, phần OAuth client đã được
nhúng sẵn trong app — ai cài cũng có. Google xếp loại OAuth client cho ứng dụng
cài sẵn là **public client**: "secret" của nó không phải bí mật thật (nó nằm
trong file cài đặt trên máy người dùng).

Vì vậy nó xuất hiện công khai trong nhiều dự án mã nguồn mở đã reverse-engineer
luồng đăng nhập của Antigravity:

- [NoeFabris/opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth/blob/main/src/constants.ts)
- [badlogic/pi-mono](https://github.com/badlogic/pi-mono/blob/a3bf1eb3/packages/ai/src/utils/oauth/google-antigravity.ts)
- [wusimpl/AntigravityQuotaWatcher](https://github.com/wusimpl/AntigravityQuotaWatcher/blob/main/src/auth/constants.ts)
- [lidge-jun/opencodex](https://github.com/lidge-jun/opencodex/blob/3e000b53/src/oauth/google-antigravity.ts)

### Cách tìm

Tìm hai câu này trên web (Google, GitHub code search, hoặc bất kỳ search engine):

```text
antigravity oauth client_id apps.googleusercontent.com
gemini-cli antigravity oauth client id redirect localhost:51121
```

Hoặc tìm trực tiếp trong mã nguồn:

```text
site:github.com "antigravity" "oauth-callback" "apps.googleusercontent.com"
```

Cần tìm đúng **bộ ba khớp nhau**: `client_id`, `client_secret`, và
`redirect_uri` = `http://localhost:51121/oauth-callback`. Nếu redirect khác
(ví dụ `localhost:36742`), đó là client của dự án khác — vẫn có thể dùng nhưng
phải khai báo đúng redirect đó trong plugin.

Hình dạng cần tìm (thay bằng giá trị **bạn tự đọc được từ nguồn**, tài liệu
này cố ý không chép giá trị thật — GitHub chặn push khi tài liệu chứa secret):

```text
client_id:     <số>-<chuỗi>.apps.googleusercontent.com
client_secret: GOCSPX-<chuỗi>
redirect_uri:  http://localhost:51121/oauth-callback
```

Lấy giá trị thật ở chính nguồn bạn tìm được ở trên, rồi kiểm chứng ở bước sau.

> Đừng tin giá trị chép từ tài liệu này hay từ blog. Google có thể thu hồi
> client bất cứ lúc nào. Luôn chạy bước kiểm chứng bên dưới trước khi dùng.

### Kiểm chứng trước khi dùng

Không cần đăng nhập thật. Gửi một `code` **cố tình sai** tới token endpoint.
Google kiểm tra client trước, rồi mới kiểm tra code — nên phản hồi cho biết
client có tồn tại hay không:

```sh
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "code=FAKE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:51121/oauth-callback"
```

Đọc `error` trong kết quả:

| `error` | Nghĩa | Kết luận |
|---|---|---|
| `invalid_grant` + "Malformed auth code" | Client đúng, chỉ chê code giả | ✅ Dùng được |
| `invalid_client` + "The OAuth client was not found" | Client không tồn tại | ❌ Sai, tìm giá trị khác |
| `redirect_uri_mismatch` | Client đúng nhưng redirect khác | ⚠️ Đổi `redirect_uri` cho khớp |

Nguyên tắc: **code sai mà không bị chê client = client đúng.**

So sánh hai lần gọi để thấy rõ khác biệt:

```sh
# Client thật
# Client thật (điền giá trị bạn vừa tìm được)
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CID" -d "client_secret=$SEC" \
  -d "code=FAKE" -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:51121/oauth-callback"
# → {"error": "invalid_grant", "error_description": "Malformed auth code."}

# Client bịa
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=999999999999-bogus.apps.googleusercontent.com" \
  -d "client_secret=GOCSPX-bogus" \
  -d "code=FAKE" -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:51121/oauth-callback"
# → {"error": "invalid_client", "error_description": "The OAuth client was not found."}
```

### Cấu hình vào plugin

Ba cách, chọn một:

**1. Qua UI (khuyến nghị)** — mở `/antigravity`, bấm banner đỏ hoặc
**+ Thêm tài khoản**, dán `CLIENT ID` + `CLIENT SECRET`, bấm **Lưu OAuth client**.

**2. Qua API**

```sh
curl -X POST http://127.0.0.1:3082/antigravity/api/oauth-client \
  -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"clientSecret\":\"$SEC\"}"
```

**3. Qua biến môi trường** (ưu tiên cao nhất, tiện cho container)

```sh
export ANTIGRAVITY_CLIENT_ID="$CID"
export ANTIGRAVITY_CLIENT_SECRET="$SEC"
```

Kiểm tra lại:

```sh
curl -s http://127.0.0.1:3082/antigravity/api/status
# {"configured": true, "source": "file" | "env", "clientIdMasked": "10710060605…", ...}
```

`clientSecret` không bao giờ được trả về trong bất kỳ phản hồi nào.

---

## B. Tự tạo client trên Google Cloud Console

Dùng khi cần kiểm soát riêng, hoặc cách A bị Google chặn.

1. Mở <https://console.cloud.google.com/apis/credentials>
2. **Create Credentials → OAuth client ID**
3. Loại **Desktop app** (đơn giản nhất — redirect `localhost` có sẵn)
   hoặc **Web application** nếu muốn một-cú-bấm (xem bảng dưới)
4. Copy `Client ID` + `Client secret`
5. Cấu hình như mục "Cấu hình vào plugin" ở trên

### Hai loại client khác nhau ở đâu

| Loại | Google cho redirect về | Hệ quả trong plugin |
|---|---|---|
| **Desktop app** | chỉ `localhost` | Sau khi đăng nhập Google trỏ về `localhost:51121` → copy URL dán lại (chế độ mặc định) |
| **Web application** | domain `https://…` | Google trỏ thẳng về `<origin>/antigravity/oauth/callback` → tự hoàn tất |

Muốn dùng loại Web application, thêm **Authorised redirect URI**:

```text
https://<domain-dsh-cua-ban>/antigravity/oauth/callback
```

Rồi gọi `POST /antigravity/api/auth/start` **không** kèm `mode: "paste"` để
nhận link dạng webflow.

---

## Đăng nhập thêm tài khoản

Sau khi có OAuth client, mỗi tài khoản Google đăng nhập như sau:

1. `/antigravity` → **+ Thêm tài khoản**
2. **Mở trang đăng nhập Google** → chọn tài khoản → đồng ý hết quyền
3. Browser nhảy sang `http://localhost:51121/oauth-callback?code=…`
   (trang báo lỗi là bình thường — `localhost:51121` không tồn tại trên máy bạn)
4. **Copy toàn bộ URL** trên thanh địa chỉ
5. Dán vào ô `DÁN URL CALLBACK` → **Kết nối tài khoản**

Kiểm tra kết quả: tài khoản hiện trong danh sách với badge `active` và đồng hồ
quota (%). Bấm **Đo quota** để lấy số mới nhất.

### Scopes mà plugin xin

```text
https://www.googleapis.com/auth/cloud-platform
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/cclog
https://www.googleapis.com/auth/experimentsandconfigs
```

Đây đúng là bộ scope app Antigravity xin khi đăng nhập lần đầu.

---

## Lỗi thường gặp

| Lỗi | Nguyên nhân | Cách xử lý |
|---|---|---|
| `redirect_uri_mismatch` | Client dùng redirect khác | Kiểm chứng ở trên; dùng đúng client + redirect đi kèm |
| `invalid_client` | Client không tồn tại / bị thu hồi | Tìm bộ client khác, hoặc tự tạo (cách B) |
| `invalid_grant` + "Malformed auth code" | Code đã dùng hoặc cắt sai | Mỗi URL chỉ dùng 1 lần; copy **toàn bộ** URL |
| `Không tìm thấy mã code` | Dán thiếu `?code=` | Copy nguyên URL trên thanh địa chỉ |
| `Phiên đăng nhập đã hết hạn` | Quá 10 phút từ lúc bấm nút Google | Bấm **Mở trang đăng nhập Google** lại từ đầu |
| `Google chưa xác minh ứng dụng này` | Client không thuộc app đã verify | **Nâng cao → Truy cập … (không an toàn)** |

---

## Ghi chú bảo mật

- Client công khai (cách A) **không phải secret của bạn** — nó nằm trong app
  Google phát hành. Nhưng đừng commit nó vào repo công khai kèm danh sách tài
  khoản; token người dùng mới là thứ cần bảo vệ.
- Access/refresh token chỉ nằm trên host, tại
  `<stateDir>/antigravity-pool.json` (mode `0600`) và `.credentials.yaml`.
  Không bao giờ xuất hiện trong phản hồi API hay log.
- Khi Google thu hồi client công khai, mọi deployment dùng nó sẽ hỏng cùng lúc.
  Cách B (client tự tạo) ổn định hơn cho production.
