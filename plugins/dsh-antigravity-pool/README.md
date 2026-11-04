# dsh-antigravity-pool

Quản lý **xoay vòng nhiều tài khoản Antigravity** (Google OAuth) cho DSH Superagent.
Khi một tài khoản chạm quota, pool tự chuyển sang tài khoản kế tiếp và cho tài khoản
kia nghỉ `cooldownMinutes` phút rồi tự phục hồi.

Phiên bản **2.8.0** — thêm **đồng hồ quota trực tiếp** cho từng tài khoản, ở cả
trang `/antigravity` lẫn thẻ **Settings → Models**.
Trang `/antigravity` vẫn là nơi thêm/xoá tài khoản, còn Settings chỉ bật/tắt,
chọn model và ngân sách token.

## Kiến trúc

```text
index.js           → DSH plugin: apply(ctx, config) + HTTP routes /antigravity/*
pool-core.mjs      → logic pool (kế thừa từ applet/antigravity-pool.mjs, đã tách cấu hình)
settings-routes.mjs→ 4 route /api/antigravity.* sau fence xác thực của DSH
client.js          → thẻ "Google Antigravity accounts" trong Settings → Models
ui.html            → trang quản lý độc lập tại /antigravity
test-pool.mjs      → 39 kiểm thử offline (fetch giả, không gọi Google)
```

Có **hai giao diện**, dùng chung một pool:

| Giao diện | Vị trí | Truy cập |
|---|---|---|
| Control room (v2.1.0) | `/antigravity` | Route `webServer` thường, không qua fence `/api` |
| Settings card (v2.2.0) | Settings → Models | Route `connection.fetch` trên `/api`, có xác thực |

Nguồn logic gốc: `applet/antigravity-pool.mjs` trong repo này (chạy tại `/app/applet`
trên máy khác). Bản plugin tách hardcoded path ra `config`/env và thêm fetch-injectable
để kiểm thử offline.

## Tính năng

- **Bootstrap tự động**: nếu pool trống, lấy grant Google từ `.credentials.yaml`
  (record `llm-pi-ai/google`) làm tài khoản đầu tiên
- **Refresh token tự động** trước khi hết hạn (5 phút dự phòng), hỗ trợ xoay
  `refresh_token` từ Google
- **Failover theo quota**: lỗi 429 / `RESOURCE_EXHAUSTED` → tài khoản vào cooldown,
  `activeIndex` chuyển sang tài khoản khỏe
- **Đồng bộ grant**: tài khoản active luôn được ghi ngược vào `.credentials.yaml`
  (mode `0600`) để provider `llm-pi-ai/google` dùng chung
- **API hợp đồng cũ**: giữ nguyên interface `getActiveValidAccount()`,
  `handleAccountQuotaExceeded()`, `recordAccountSuccess()`… để applet hoặc plugin khác gọi

## Cài vào DSH

1. Đặt thư mục này vào máy chủ (hoặc `git clone` + copy như các plugin khác).
2. Cài dependency (thư mục profile đã có `yaml`; nếu chưa:

   ```sh
   cd plugins/dsh-antigravity-pool
   npm install --ignore-scripts
   ```

3. Đăng ký bundle — thêm vào `cordis.patch.yml` của profile:

   ```yaml
   - insert:
       - id: dsh-antigravity-pool
         name: '@local/dsh-antigravity-pool'
         config:
           stateDir: /data/home/state/superagent/antigravity-pool
           credentialsFile: /data/home/.credentials.yaml
   ```

4. Cấu hình OAuth client — xem hướng dẫn riêng:
   **[docs/oauth-client.md](docs/oauth-client.md)**.
   Ngắn gọn: dán `CLIENT ID` + `CLIENT SECRET` vào banner đỏ hoặc trong
   **+ Thêm tài khoản**. Không nhất thiết phải tự tạo client trên Google
   Cloud Console — client công khai của app Antigravity dùng được, và tài
   liệu trên chỉ cách tìm + kiểm chứng trước khi dùng.

   Plugin lưu client vào `<stateDir>/oauth-client.json` với mode `0600` trên
   volume — không nằm trong git. Biến môi trường
   `ANTIGRAVITY_CLIENT_ID` / `ANTIGRAVITY_CLIENT_SECRET` được ưu tiên nếu có.
5. Khởi động lại DSH khi các phiên đã rảnh.

## Model và quota

Hai tài liệu riêng:

- **[docs/models-and-quota.md](docs/models-and-quota.md)** — 26 model dùng được
  (Claude 5.5, Gemini 4 Argon / 3.8 Flash / 3.1 Flash Image, GPT-OSS), khả năng
  từng model, và cách quota chia **2 nhóm × 2 cửa sổ** (5h + weekly) chứ không
  theo từng model. Ghi rõ cái bẫy User-Agent: UA 1.x chỉ trả nhóm Claude/GPT và
  giấu hẳn nhóm Gemini.
- **[docs/oauth-client.md](docs/oauth-client.md)** — lấy và kiểm chứng OAuth
  client.

API tương ứng:

| Route | Trả về |
|---|---|
| `GET /antigravity/api/models` | Danh sách model + khả năng + % từng model |
| `GET /antigravity/api/quota-summary` | 2 nhóm × 2 cửa sổ, đúng như app |
| `POST /antigravity/api/quota` | Probe tài khoản, kèm `groups` |

## Trang quản lý & API

Mở **`/antigravity`** trong browser của DSH — "control room" dark dashboard:

- Dải 8 chỉ số realtime: tổng tài khoản, sẵn sàng, nghỉ quota, requests, con trỏ
  active, quota hits, lỗi gần nhất, cooldown
- Thẻ tài khoản với avatar trạng thái (xanh = active, hổ phách = cooldown, đỏ = lỗi),
  hết hạn cảnh báo vàng khi còn < 10 phút, email + project + counter
- Nút thao tác ngay trên thẻ: **Chọn / Test / Reset / Gỡ**; modal thêm tài khoản
  (email, access, refresh, project, expires)
- Nhật ký pool dạng stream (info/auth/quota/error), auto-refresh 5 giây
- Banner đỏ khi chưa có OAuth client — bấm vào là mở form nhập ngay
- Giao diện tự chứa 100% (`ui.html`) — không CDN, không font/icon ngoài;
  sửa `ui.html` là có tác dụng ngay, không cần restart

| Route | Mô tả |
|---|---|
| `GET /antigravity` | Trang UI quản lý |
| `GET /antigravity/api/pool` | View pool (đã ẩn access/refresh) |
| `GET /antigravity/api/status` | Trạng thái env OAuth (masked) |
| `POST /antigravity/api/auth/start` | Tạo link đăng nhập Google (PKCE S256 + offline access), trả `{authUrl, codeVerifier}` |
| `POST /antigravity/api/auth/exchange` | Nhận URL callback (hoặc code thô) dán lại → đổi token → thêm vào pool |
| `GET /antigravity/api/account` | Lấy tài khoản active (tự refresh); `?rotate=next` để xoay |
| `POST /antigravity/api/account` | Thêm/cập nhật tài khoản `{email, access, refresh, expires, projectId}` |
| `POST /antigravity/api/quota-exceeded` | Báo quota chạm trần `{id, error}` → cooldown + rotate |
| `POST /antigravity/api/success` | Báo thành công `{id}` → tăng counter |
| `POST /antigravity/api/activate` | Chọn active `{id}` |
| `POST /antigravity/api/reset-quota` | Xóa cooldown `{id}` |
| `POST /antigravity/api/test` | Probe `fetchAvailableModels` của Cloud Code |
| `POST /antigravity/api/config` | Đổi `{cooldownMinutes, retryOnQuota, strategy}` |
| `POST /antigravity/api/remove` | Gỡ tài khoản `{id}` |

## Thẻ Settings → Models

Giao diện thứ hai nằm ngay trong hộp thoại Settings của DSH, dưới danh sách
provider model. Nó cần service `connection` của DSH Web; composition không có
service này (headless/ACP) sẽ bỏ qua thẻ và chỉ giữ trang `/antigravity`.

| Thành phần | Chức năng |
|---|---|
| `Google Antigravity accounts` | Hiển thị `x/y tài khoản sẵn sàng` |
| `Add account` | Modal đăng nhập Google: tạo URL PKCE, dán redirect URL để đổi code |
| `Use this account` | Chuyển tài khoản đang dùng |
| `Test` | Gọi `fetchAvailableModels` kiểm tra quota |
| `Reset quota` | Xoá cooldown của tài khoản |
| `Remove` | Xoá tài khoản khỏi pool |
| Cooldown (phút) | Lưu `cooldownMinutes` |

Bốn route của thẻ:

| Route | Method | Việc |
|---|---|---|
| `/api/antigravity.pool` | GET, HEAD | Snapshot pool đã lọc token |
| `/api/antigravity.authUrl` | POST | Tạo URL Google PKCE |
| `/api/antigravity.exchange` | POST | Đổi code → lưu tài khoản |
| `/api/antigravity.action` | POST | `select`, `remove`, `test`, `reset-quota`, `config` |

Access/refresh token **không bao giờ** rời khỏi host: route status chỉ trả
snapshot đã qua `getSanitizedPoolView()`.

## Quota trực tiếp

Mỗi tài khoản hiện **phần trăm quota còn lại** kèm thanh tiến trình, model thắt
cổ chai và giờ reset. Số này lấy từ chính Google, không phải phỏng đoán.

Cách đọc: Cloud Code Assist trả `quotaInfo.remainingFraction` cho từng model
trong `fetchAvailableModels`. Phần trăm hiển thị là **mức thấp nhất** trong các
model chat (`gemini-4-argon`, `gemini-3.8-flash`, `gemini-3-flash`,
`gemini-3.1-flash*`) — vì một model cạn là đủ để trả 429, không phải mức trung bình.

| Mức | Màu | Ý nghĩa |
|---|---|---|
| ≥ 60% | xanh | thoải mái |
| 25–59% | cam | nên để ý |
| < 25% | đỏ | sắp chạm giới hạn |

Số đo được lưu vào `antigravity-pool.json` (`lastQuota`) nên lần mở sau hiện ngay.
Trang tự đo lại khi số cũ hơn 10 phút; nút **Đo quota** / **Đo lại quota** ép đo
một tài khoản, **Đo tất cả** đo cả pool.

Hai route mới:

| Route | Method | Việc |
|---|---|---|
| `/antigravity/api/quota` | GET, POST | Đo quota (trang quản lý) |
| `/api/antigravity.quota` | GET, POST | Đo quota (thẻ Settings, sau xác thực) |

## Bảo mật

- OAuth client nhập từ UI được lưu ở `<stateDir>/oauth-client.json` mode `0600`
  (ngoài git, trên volume). Env `ANTIGRAVITY_CLIENT_ID/SECRET` vẫn được ưu tiên
  nếu có. Không hard-code, không commit. `.env` đã bị `.gitignore` ở gốc repo.
- Access/refresh token của các tài khoản chỉ nằm trong `antigravity-pool.json`
  (mode `0600`) và `.credentials.yaml` ngoài stateDir — không bao giờ xuất hiện
  trong API view hay log.
- `clientId` chỉ trả về dạng mask (`abc123…` qua `/api/status`).

## Kiểm thử

```sh
cd plugins/dsh-antigravity-pool
node test-pool.mjs
```

17 kiểm thử offline: bootstrap từ credentials, refresh + xoay refresh_token,
fail-open khi thiếu env, failover quota, cooldown tự phục hồi, sanitize view,
toàn bộ HTTP routes, UI render. Fetch được giả lập — không gọi API Google thật.
