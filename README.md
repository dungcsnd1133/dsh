# DSH

Bộ cài lại đúng bản đang chạy trên máy Windows, cổng `3082`, model `grok-4.7`, plugin media nằm ở [dungcsnd1133/dsh-media](https://github.com/dungcsnd1133/dsh-media).

Repo này không chứa mã nguồn DeepSeek, không chứa `node_modules`, không chứa khóa API, token Cloudflare, hay lịch sử chat. Mã DSH lấy từ repo chính thức khi cài.

## Tạo API key xAI

1. Đăng nhập [console.x.ai](https://console.x.ai/).
2. Mở [API Keys](https://console.x.ai/team/default/api-keys).
3. Tạo một key mới. Copy ngay, trang chỉ hiện đầy đủ một lần.
4. Trên máy Windows, tạo file một dòng, không xuống dòng thừa, không có dấu ngoặc:

```text
D:\dsh\home\xai.key
```

Nội dung là key vừa copy. File này không được commit. `start.cmd` đọc file đó vào biến `XAI_API_KEY`.

DSH lấy key qua `apiKeyEnv: XAI_API_KEY` trong [profile/cordis.patch.yml](profile/cordis.patch.yml). Không ghi key vào yaml.

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
