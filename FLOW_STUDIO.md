# Flow Studio — tạo & dựng video AI từ prompt và hình ảnh

Web app (giao diện tiếng Việt) theo quy trình kiểu "AI filmmaking": tạo clip bằng **Google Veo** từ prompt / hình ảnh, rồi dựng cảnh trên timeline và xuất MP4 bằng **Remotion**.

## Tính năng

**Tạo nội dung (Thư viện)**
- **Văn bản → Video**: mô tả cảnh quay, Veo tạo clip 4–8 giây (Veo 3+ có âm thanh).
- **Khung hình → Video**: chọn khung đầu (và khung cuối tuỳ chọn), Veo tạo chuyển động giữa chúng.
- **Thành phần → Video**: tối đa 3 ảnh nhân vật / đồ vật làm tham chiếu (Veo 3.1).
- **Tạo ảnh**: tạo hoặc chỉnh ảnh bằng Gemini 2.5 Flash Image, dùng làm khung hình / thành phần.
- **Kéo dài clip**: nối thêm ~7 giây vào clip do Veo tạo.
- **Lấy khung cuối**: biến khung cuối của một clip thành khung đầu cho cảnh tiếp theo (nối cảnh liền mạch).
- Tuỳ chọn model, thời lượng, độ phân giải, số kết quả (1–4), prompt phủ định; tải ảnh / video của bạn lên.

**Dựng cảnh (Scene builder)**
- Xem trước bằng Remotion Player, timeline kéo thả để sắp xếp.
- Cắt đầu / cuối, âm lượng, tách clip tại vị trí phát, nhân đôi, xoá.
- Ảnh tĩnh có chuyển động Ken Burns (phóng to, thu nhỏ, lia).
- Chuyển cảnh: mờ dần, trượt, quét, lật, quét đồng hồ, mống mắt.
- Chữ trên cảnh: vị trí, hiệu ứng (hiện dần, trượt lên, bật ra, đánh máy), màu, cỡ, nền.
- **Xuất MP4** 480p / 720p / 1080p, khung 16:9 hoặc 9:16.

**Chế độ Demo**: khi chưa có Gemini API key, app vẫn chạy đủ quy trình — clip được giả lập bằng Remotion (miễn phí), tiện để thử giao diện và tính năng dựng.

## Chạy

Cần Node.js 18+.

```bash
npm install
```

```bash
npm run flow
```

Mở http://localhost:3123. Lệnh này build giao diện rồi chạy server.

Khi phát triển (tự reload):

```bash
npm run flow:server
```

```bash
npm run flow:web
```

Rồi mở http://localhost:5173.

### Gemini API key

- Lấy key tại https://aistudio.google.com/apikey.
- Nhập trong **Cài đặt** trên giao diện (lưu trong trình duyệt), hoặc đặt cho server: `GEMINI_API_KEY=... npm run flow`.
- Tạo video bằng Veo có tính phí theo tài khoản Google của bạn.

### Biến môi trường

| Biến | Ý nghĩa |
|------|---------|
| `GEMINI_API_KEY` | Key mặc định của server (tuỳ chọn) |
| `PORT` | Cổng server, mặc định `3123` |
| `REMOTION_BROWSER_EXECUTABLE` | Đường dẫn Chrome/Chromium có sẵn, nếu máy không tải được Chrome Headless Shell của Remotion |

## Cấu trúc

```
src/flow/            # Remotion: FlowTimeline (dựng timeline), MockClip (clip demo), types dùng chung
server/index.ts      # Express: dự án, tải tệp, gọi Veo/Gemini, render bằng @remotion/renderer
web/                 # React + Vite + @remotion/player (giao diện)
flow-data/           # Dữ liệu dự án và media (tự tạo, đã gitignore)
```

Composition `FlowTimeline` và `FlowMockClip` cũng xuất hiện trong Remotion Studio (`npm run dev`) ở thư mục **FlowStudio**.

## Bản chạy trong Claude (Artifact)

`artifact/flow-studio.html` là bản rút gọn chạy hoàn toàn trong trình duyệt: tải ảnh, nhờ Claude lên kịch bản bằng prompt, chỉnh cảnh / chữ / chuyển cảnh và xuất MP4/WebM. Đã đăng tại https://claude.ai/artifact/N1np64qtRcVLNUt4tJ3TQy (riêng tư, chia sẻ qua menu Share).
