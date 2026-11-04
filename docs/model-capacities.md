# Giới hạn model đã cấu hình — 04/11/2026

TLPRO hiện trả tên model qua `/models` nhưng không kèm dung lượng. Bản cập nhật
khai báo metadata cho từng ID để bộ nén gốc và popup dùng cùng thông số.

| Model | Ngữ cảnh | Đầu ra tối đa |
| --- | ---: | ---: |
| deepseek-v4.1-flash | 1.000.000 | 393.216 |
| glm-5.3 | 1.000.000 | 131.072 |
| glm-5.3-flash | 1.000.000 | 131.072 |
| gpt-6-astra | 1.050.000 | 128.000 |
| gpt-6.1-sol | 1.050.000 | 128.000 |
| gpt-6.1-terra | 1.050.000 | 128.000 |
| gemini-4-argon | 1.048.576 | 65.536 mỗi lượt stream |

GPT có thêm trần đầu vào 922.000 token. Đầu vào, đầu ra và dự phòng nén chia sẻ
ngữ cảnh, nên tăng đầu vào có thể giảm đầu ra MAX. Dự phòng nén hiện là 65.536
token. Ví dụ GLM: đầu vào mặc định 695.142, đầu ra MAX 131.072.

Gemini long decode cần hỗ trợ continuation riêng. Tuyến OpenAI-compatible này
chưa được kiểm chứng hỗ trợ tính năng đó, nên dùng giới hạn stream thông thường.
Thông số dựa trên tài liệu hãng; chưa kiểm tra bằng một yêu cầu TLPRO gần 1M token.

Dòng phần trăm trên lượt chat cũ là số liệu yêu cầu đã chạy, có thể vẫn hiện mẫu
số 262K tới lượt xử lý tiếp theo. Không sửa lịch sử để thay số đó.

## Nguồn

- [DeepSeek Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek V4.1 Flash trên Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/deepseek-v4-1-flash)
- [GLM 5.3](https://docs.z.ai/guides/llm/glm-5.3)
- [GLM 5.3 Flash](https://docs.z.ai/guides/vlm/glm-5.3-flash)
- [GLM max_tokens](https://docs.z.ai/guides/overview/concept-param)
- [GPT 6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [GPT 6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [GPT 6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
- [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)
