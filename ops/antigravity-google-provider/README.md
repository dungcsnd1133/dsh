# Nối Antigravity (Google Cloud Code Assist) vào DSH

Biến DSH thành client của **Antigravity** — dùng OAuth Google thay vì API key
Gemini, kèm xoay vòng nhiều tài khoản.

Đây là bản port từ `applet/patch-aistudio-session.mjs` (chạy trên AI Studio)
sang cấu trúc runtime của DSH, để dùng được trên Railway/volume.

## Vì sao cần patch

`pi-ai` có provider `google` nhưng chỉ hỗ trợ **API key** (`GEMINI_API_KEY`)
qua `generativelanguage.googleapis.com`. Antigravity dùng đường khác hẳn:

| | Gemini API key | Antigravity |
|---|---|---|
| Xác thực | API key tĩnh | OAuth (access/refresh token) |
| Endpoint | `generativelanguage.googleapis.com/v1beta` | `daily-cloudcode-pa.sandbox.googleapis.com/v1internal` |
| Header | `x-goog-api-key` | `Bearer` + `User-Agent: antigravity/...` + `Client-Metadata` |
| Hạn mức | theo key | theo **tài khoản Google** → xoay được |

Nên phải thêm `googleAntigravityOAuth` vào provider và một nhánh stream riêng
gọi `v1internal:streamGenerateContent`.

## Script patch

`patch-pi-ai.mjs` ghi 4 thứ vào runtime DSH:

| File | Thay đổi |
|---|---|
| `@earendil-works/pi-ai/dist/auth/oauth/google-antigravity.js` | OAuth flow mới (PKCE, callback localhost:51121, `loadCodeAssist` để tìm project) |
| `@earendil-works/pi-ai/dist/providers/google.js` | thêm `oauth: googleAntigravityOAuth` cạnh `apiKey` |
| `@earendil-works/pi-ai/dist/api/google-generative-ai.js` | nhánh `createAntigravityStream` + fallback endpoint/model |
| `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | chấp nhận credential OAuth cho provider google |

Mỗi file có backup `.before-*` và script chạy lặp lại được.

```sh
# xem trước, không ghi
node patch-pi-ai.mjs --dry-run

# áp dụng (mặc định trỏ /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules)
node patch-pi-ai.mjs

# runtime ở chỗ khác
node patch-pi-ai.mjs --root /path/to/dsh/node_modules
```

Khôi phục: copy các file `.before-*` đè lại rồi restart DSH.

## Khai báo provider

Thêm vào `cordis.patch.yml` của profile:

```yaml
- id: llm-pi-ai
  config:
    providers:
      google:
        displayName: AI Studio (Antigravity)
        # KHÔNG đặt `api:` — schema rc.5 từ chối override protocol lạ và
        # plugin sẽ không đăng ký adapter nào, làm mất luôn các provider khác.
        models:
          - id: gemini-4-argon
            name: Gemini 4 Argon
            contextWindow: 1048576
            maxTokens: 65536
            input: [text, image]
          - id: gemini-3.8-flash
            name: Gemini 3.8 Flash
            contextWindow: 1048576
            maxTokens: 65536
            input: [text, image]
```

> **Bẫy đã gặp (04/11/2026):** đặt `api: google-generative-ai` khiến
> `dsh-llm-pi-ai` ném lỗi schema lúc khởi động, **không adapter nào được
> đăng ký** — model picker báo `No models available`, chat báo `NO_ADAPTER`
> cho cả TLPRO. Bỏ trường `api` là hết. Xem
> [`ops/model-catalog-recovery`](../model-catalog-recovery/README.md).

## OAuth client

Antigravity dùng OAuth client **công khai nhúng sẵn trong app desktop của
Google** — không phải secret của người dùng, không cần tạo trên Google Cloud
Console. Vì GitHub push protection chặn chuỗi `GOCSPX-…`, hai giá trị này
không nằm trong repo; lấy chúng từ một trong hai nguồn:

```sh
# 1. nếu đã cấu hình trên máy: đọc từ pool state (mode 0600, ngoài git)
cat /data/.dsh/state/superagent/antigravity-pool/oauth-client.json

# 2. hoặc từ các dự án mở dùng chung client này
#    (opencode-antigravity-auth, pi-mono, AntigravityQuotaWatcher)
```

Redirect URI: `http://localhost:51121/oauth-callback`

Kiểm tra client còn sống:

```sh
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CID" -d "client_secret=$CSEC" \
  -d "code=FAKE" -d "grant_type=authorization_code" \
  -d "redirect_uri=http://localhost:51121/oauth-callback"
```

`invalid_grant` = client hợp lệ (code sai). `invalid_client` = client đã bị thu hồi.

## Đăng nhập và xoay tài khoản

Luồng OAuth chạy qua plugin [`dsh-antigravity-pool`](../../plugins/dsh-antigravity-pool/README.md):

1. `/antigravity` → **+ Thêm tài khoản**
2. **Mở trang đăng nhập Google** → chọn tài khoản → đồng ý
3. Browser nhảy về `localhost:51121/oauth-callback?code=…` (trang lỗi, bình thường)
4. Copy nguyên URL → dán vào ô → **Kết nối**

Token lưu ở `.credentials.yaml` và pool state (mode `0600`), không lên git.
Plugin tự refresh trước khi hết hạn, và xoay sang tài khoản khác khi chạm quota.

## Sau khi nâng cấp DSH

`npm install -g @deepseek-ai/dsh@<version>` ghi đè `pi-ai` → **patch mất**.
Chạy lại `node patch-pi-ai.mjs` và kiểm tra model vẫn còn trong picker.
