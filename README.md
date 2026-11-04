# DSH

## Khôi phục danh sách model — 04/11/2026

[Sửa lỗi adapter khi cấu hình Google](ops/model-catalog-recovery/README.md):
bỏ protocol override không hợp lệ, khôi phục 7 model TLPRO và 2 model Google,
giữ nguyên tài khoản và các thông số model.

## Menu model và hiển thị code — 04/11/2026

[Bản sửa menu model trên điện thoại](ops/mobile-model-menu/README.md) tránh
tự bật bàn phím, mở rộng danh sách và giữ menu trong vùng nhìn thấy khi tìm
kiếm. Đã tắt `dsh-inline-diff` trên web để các thay đổi code nằm trong hàng
thu gọn, bấm mới mở chi tiết.

## Tự phục hồi Railway và media — 04/11/2026

[Bộ giám sát DSH và Cloudflare Tunnel](ops/reliability/README.md) chạy lại tiến
trình khi thoát, kể cả mã 0. Railway dùng `restartPolicyType: ALWAYS`.
Chuỗi vá context-auto và đăng nhập Safari vẫn được giữ nguyên.

Plugin [dsh-media](https://github.com/dungcsnd1133/dsh-media) 1.3.0 mặc định tạo
và sửa ảnh bằng `cx/gpt-image-2.5`; có Gemini 512/1K/2K/4K. Đã gỡ công cụ tạo
ảnh/video x.ai, giữ TTS và khả năng xem/tải media cũ.

## Cập nhật ngân sách ngữ cảnh — 04/11/2026

Đã bổ sung [plugin chọn ngân sách token](plugins/dsh-context-auto/README.md)
phiên bản **1.1.2**, hiện chạy tại https://dsh.hoantienmuasam.net/.
DeepSeek, GLM, GPT và Gemini dùng [giới hạn từng model](docs/model-capacities.md)
khoảng 1M ngữ cảnh; đầu vào tùy chỉnh, đầu ra mặc định MAX.
Có 13 kiểm thử, cấu hình metadata mẫu và ảnh kiểm chứng.

Hướng dẫn Windows bên dưới được giữ cho bộ cài gốc. Plugin mới cần áp dụng bản
vá DSH rc.5 theo README của nó trước khi bật trên máy khác.

## Bộ cài Windows gốc

Bộ cài lại đúng bản đang chạy trên máy Windows, cổng `3082`, model `grok-4.7`, plugin media nằm ở [dungcsnd1133/dsh-media](https://github.com/dungcsnd1133/dsh-media).

Repo này không chứa mã nguồn DeepSeek, không chứa `node_modules`, không chứa khóa API, token Cloudflare, hay lịch sử chat. Mã DSH lấy từ repo chính thức khi cài.

## Key xAI đã có

Không tạo key mới. Không in key ra chat.

File đã nằm trên máy Windows, một dòng:

```text
D:\dsh\home\xai.key
```

`D:\dsh\start.cmd` đọc file đó vào biến `XAI_API_KEY` trước khi chạy DSH. File yaml chỉ khai báo `apiKeyEnv: XAI_API_KEY` và model mặc định `grok-4.7`. Key không có trong Git.

Phiên chat mới không có biến `XAI_API_KEY`. Biến đó chỉ được Grok gắn vào một số phiên cũ. Phiên mới SSH vào máy, thấy file trên là đủ, rồi dùng DSH đang chạy. Không xin key, không tạo key trên console nếu file còn.

## Cài

Cần Node.js. Bản DSH đang dùng là `@deepseek-ai/dsh@0.2.1-rc.5`.

```powershell
$env:npm_config_prefix = 'D:\dsh\npm'
$env:npm_config_cache = 'D:\dsh\npm-cache'
npm install -g '@deepseek-ai/dsh@0.2.1-rc.5' pnpm@11.7.0
```

Tải mã superagent và build:

```powershell
New-Item -ItemType Directory -Force D:\dsh\src | Out-Null
Invoke-WebRequest https://github.com/deepseek-ai/dsh-superagent-prototype/archive/refs/heads/main.zip -OutFile D:\dsh\src\repo.zip
Expand-Archive -Force D:\dsh\src\repo.zip D:\dsh\src
cd D:\dsh\src\dsh-superagent-prototype-main
D:\dsh\npm\pnpm.cmd install --store-dir D:\dsh\pnpm-store
D:\dsh\npm\pnpm.cmd build
```

Lấy plugin và profile từ repo này:

```powershell
git clone https://github.com/dungcsnd1133/dsh.git D:\dsh\kit
git clone https://github.com/dungcsnd1133/dsh-media.git D:\dsh\plugins\dsh-media
git clone https://github.com/dungcsnd1133/dsh-video-watch.git D:\dsh\plugins\dsh-video-watch
Copy-Item -Recurse D:\dsh\kit\plugins\* D:\dsh\plugins\
$env:DSH_HOME = 'D:\dsh\home'
D:\dsh\npm\dsh.cmd superagent --from-default-profile web --dump-config
Copy-Item D:\dsh\kit\profile\* D:\dsh\home\profiles\superagent\ -Force
Copy-Item D:\dsh\kit\scripts\start.cmd D:\dsh\start.cmd -Force
```

Trong thư mục profile, cài dependency rồi chạy:

```powershell
cd D:\dsh\home\profiles\superagent
D:\dsh\npm\pnpm.cmd install
D:\dsh\start.cmd
```

Trang nghe ở `http://127.0.0.1:3082`. Bản public hiện tại là `https://agent.hoantienmuasam.net/`.

## Đang bật

| Plugin | Nguồn |
|---|---|
| `dsh-superagent` | [deepseek-ai/dsh-superagent-prototype](https://github.com/deepseek-ai/dsh-superagent-prototype) |
| `dsh-media` | [dungcsnd1133/dsh-media](https://github.com/dungcsnd1133/dsh-media) |
| `dsh-video-watch` | [dungcsnd1133/dsh-video-watch](https://github.com/dungcsnd1133/dsh-video-watch). Cần `ffmpeg` và `yt-dlp`. |
| `dsh-media-play`, `hide-session-memory-hud` | thư mục `plugins/` trong repo này |
| `dsh-mobile`, `dshmarket`, `brooks-lint`, `@bangbang-03/dsh-memory`, `dsh-web-artifact-designer` | npm, đúng phiên bản trong `profile/package.json` |

Model mặc định: `xai` / `grok-4.7`. Feishu tắt.
