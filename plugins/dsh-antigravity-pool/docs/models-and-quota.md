# Model và quota Antigravity

Tài liệu này trả lời hai câu: **dùng được model nào** và **quota tính theo nhóm nào**.
Số liệu lấy trực tiếp từ API của tài khoản đang kết nối, không phải chép từ tài liệu
Google.

---

## 1. Quota chia theo NHÓM, không theo từng model

Đây là điểm dễ hiểu nhầm nhất. Antigravity không cho mỗi model một quota riêng.
Nó gom model thành **hai nhóm**, mỗi nhóm có **hai cửa sổ thời gian**:

| Nhóm | Model trong nhóm | Cửa sổ |
|---|---|---|
| **Gemini Models** | Gemini Flash, Gemini Pro, Flash Image | `5h` (cuộn 5 giờ) + `weekly` (7 ngày) |
| **Claude and GPT models** | Claude Opus, Claude Sonnet, GPT-OSS | `5h` + `weekly` |

Model trong cùng nhóm **dùng chung** một quota. Dùng nhiều Gemini Flash thì
Gemini Pro cũng giảm theo.

### Endpoint trả về nhóm

`fetchAvailableModels` (endpoint dễ tìm) **chỉ trả quota từng model** — nó
không thấy giới hạn weekly. Muốn đúng số như app Antigravity hiển thị, phải gọi:

```http
POST https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary
Authorization: Bearer <access_token>
Content-Type: application/json
User-Agent: antigravity/hub/2.24.0 darwin/arm64
X-Goog-Api-Client: google-cloud-sdk vscode_cloudshelleditor/0.1
Client-Metadata: {"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}

{"project":"<project_id>"}
```

Phản hồi:

```json
{
  "groups": [
    {
      "displayName": "Gemini Models",
      "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        { "bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 0.79,
          "resetTime": "2026-11-10T11:12:20Z", "displayName": "Weekly Limit Remaining" },
        { "bucketId": "gemini-5h", "window": "5h", "remainingFraction": 0.94,
          "resetTime": "2026-11-04T19:34:22Z", "displayName": "Five Hour Limit Remaining" }
      ]
    },
    {
      "displayName": "Claude and GPT models",
      "buckets": [
        { "bucketId": "3p-weekly", "window": "weekly", "remainingFraction": 1 },
        { "bucketId": "3p-5h", "window": "5h", "remainingFraction": 1 }
      ]
    }
  ]
}
```

### ⚠️ User-Agent quyết định kết quả

Đây là cái bẫy đã gặp thật khi làm plugin:

| User-Agent | Nhóm nhận được |
|---|---|
| `antigravity/1.15.8 darwin/arm64` | **chỉ** `Claude and GPT models` — thiếu hẳn Gemini |
| `antigravity/hub/2.24.0 darwin/arm64` | **cả hai** nhóm, đủ 4 bucket |

Endpoint `daily-cloudcode-pa.googleapis.com` **gates nhóm Gemini theo phiên bản
client trong UA**. Dùng UA 1.x sẽ tưởng tài khoản chỉ có quota Claude/GPT trong
khi thực tế Gemini vẫn dùng được. Plugin dùng hằng số
`ANTIGRAVITY_PROBE_USER_AGENT` cho việc này.

Ngoài ra `cloudcode-pa.googleapis.com` (prod) trả bucket Gemini cho tài khoản
consumer nhưng luôn là `100%` — số giả, không phải quota thật. Vì vậy thứ tự
endpoint là **daily → sandbox → prod**, và daily thắng.

---

## 2. Model dùng được

Endpoint:

```http
POST https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels
{"project":"<project_id>"}
```

Mỗi model trả `displayName`, `supportsImages`, `supportsThinking`, `maxTokens`
(context window), `maxOutputTokens`, `modelProvider`, `quotaInfo`, cùng vài
nhóm phân loại (`imageGenerationModelIds`, `webSearchModelIds`, …).

### Danh sách thực tế (26 model, đo trên deployment này)

**Claude** — ngữ cảnh 1M, output 128K, đọc ảnh, có thinking, 3 mức effort:

| Model | Ghi chú |
|---|---|
| `claude-opus-5-5-{low,medium,high}` | Opus 5.5, 3 mức |
| `claude-sonnet-5-5-{low,medium,high}` | Sonnet 5.5, 3 mức |

**Gemini** — 3 phiên bản × 3 mức effort, cộng bản tiered/flash riêng:

| Model | Context | Output | Ghi chú |
|---|---|---|---|
| `gemini-4-argon-{low,medium,high}` | 1.048.576 | 65.536 | Mới nhất |
| `gemini-3.8-flash-{low,medium,high}` | 1.048.576 | 65.536 | |
| `gemini-3.8-flash-tiered` | 1.048.576 | 65.536 | tier `pro`, route theo mức |
| `gemini-3.5-flash-lite` | 1.048.576 | 65.535 | tier `flashLite` |
| `gemini-3-flash` | 1.048.576 | 65.536 | model lệnh |
| `gemini-3.1-flash-{lite,image}` | 1.048.576 / 65.536 | | `image` sinh ảnh, không thinking |
| `gemini-2.5-pro` | 1.048.576 | 65.535 | |
| `gemini-2.5-flash{,-lite,-thinking}` | 1.048.576 | 65.535 | hiển thị tên "Gemini 3.5 Flash Lite" |

**Khác**:

| Model | Context | Output | Đọc ảnh | Ghi chú |
|---|---|---|---|---|
| `gpt-oss-120b-medium` | 131.072 | 32.768 | ✗ | chỉ text |
| `chat_20706`, `chat_23310` | 16K / 32K | | ✗ | model nội bộ cho tab |
| `tab_flash_lite_preview`, `tab_jump_flash_lite_preview` | 16K | 4.096 | ✗ | completion trong editor |

> Tên `gemini-2.5-*` trả về `displayName` khác (ví dụ "Gemini 3.5 Flash Lite").
> Dùng **id** để gọi API, dùng `displayName` để hiển thị.

**Nhóm phân loại** trong phản hồi:

| Field | Ý nghĩa |
|---|---|
| `defaultAgentModelId` | model agent mặc định (`claude-sonnet-4-6`) |
| `commandModelIds` | dùng cho lệnh nhanh |
| `imageGenerationModelIds` | model sinh ảnh |
| `webSearchModelIds`, `mqueryModelIds` | model cho tìm kiếm web |
| `audioTranscriptionModelIds` | model phiên âm |
| `tieredModelIds` | `{flashLite, flash, pro}` — route theo mức effort |

---

## 3. Dùng trong plugin

| Route | Trả về |
|---|---|
| `GET /antigravity/api/models` | 26 model + khả năng + % quota từng model |
| `GET /antigravity/api/quota-summary` | 2 nhóm × 2 cửa sổ đúng như app |
| `POST /antigravity/api/quota` | probe từng tài khoản, kèm `groups` |

```sh
curl -s http://127.0.0.1:3082/antigravity/api/models | jq '.count'
# 26

curl -s http://127.0.0.1:3082/antigravity/api/quota-summary | jq '.groups[].buckets[] | {id, window, percent}'
# {"id":"gemini-weekly","window":"weekly","percent":79}
# {"id":"gemini-5h","window":"5h","percent":94}
# {"id":"3p-weekly","window":"weekly","percent":100}
# {"id":"3p-5h","window":"5h","percent":100}
```

Card Settings có cùng dữ liệu qua `/api/antigravity.models`.

---

## 4. Vì sao số trong plugin khác số trên web

Có ba nguồn số khác nhau, đừng so sánh chéo:

| Nơi | Đo cái gì | Cửa sổ |
|---|---|---|
| `quota[].percent` (thanh chính) | Model chat **thấp nhất** | theo model |
| `quota[].groups` | Từng nhóm × cửa sổ | 5h / weekly |
| `models[].percent` | Từng model | theo model |

Thanh % chính lấy **model thấp nhất** — vì một model cạn là đủ trả 429, lấy
trung bình sẽ che mất vấn đề. Muốn biết còn dùng được Gemini không, xem
`groups` → nhóm `Gemini Models` → bucket `5h`.

---

## Nguồn tham khảo

- [Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager/blob/main/src-tauri/src/modules/quota.rs) — `retrieveUserQuotaSummary`, thứ tự endpoint dự phòng
- [CLIProxyAPI #3876](https://github.com/router-for-me/CLIProxyAPI/issues/3876) — weekly chỉ có ở summary
- [oh-my-pi #9940](https://github.com/can1357/oh-my-pi/issues/9940) — cấu trúc `groups`/`buckets` gốc
- [t3code #21115](https://github.com/pingdotgg/t3code/issues/21115) — UA gating nhóm Gemini, prod trả bucket giả
