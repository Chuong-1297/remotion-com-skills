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

**Tách nền video** (nút kéo trên thẻ video trong Thư viện)
- Dùng `@remotion/video-matting`, chạy ngay trong trình duyệt bằng GPU (WebGPU), không gửi video đi đâu.
- Model **MODNet** (người, ~26 MB) hoặc **BEN2** (mọi vật thể, ~219 MB, thử nghiệm).
- Tạo 2 lớp: người/vật thể với nền trong suốt, và lớp nền gốc. Trên timeline: chọn nền mới (màu, ảnh, video) hoặc bật **Chữ nằm sau người**.
- Cần Chrome/Edge bản mới trên máy có card đồ hoạ.

**Tách nền ảnh và đặt nhân vật vào video**
- Trên thẻ ảnh trong Thư viện, bấm nút kéo (Tách nền): Transformers.js chạy model **MODNet** (người) hoặc **BEN2** (mọi vật thể) ngay trong trình duyệt. Có card đồ hoạ thì dùng WebGPU, không có thì chạy bằng CPU. Lần đầu cần tải model từ huggingface.co.
- Xem trước kết quả cạnh ảnh gốc, rồi lưu thành ảnh PNG nền trong suốt.
- Trong Dựng cảnh, chọn một cảnh bất kỳ (video, ảnh, nhân vật 3D) → **Nhân vật đặt vào cảnh** → chọn ảnh đã tách nền. Chỉnh vị trí, chiều cao, xoay, độ sáng (cho hợp ánh sáng của cảnh), bóng đổ, lật ngang, hiệu ứng xuất hiện (bật ra, hiện dần, trượt vào, trồi lên) và chuyển động nhẹ (nhún, thở, lắc lư). Một cảnh đặt được nhiều nhân vật.
- Ảnh đã tách nền cũng có thể làm cảnh chính, với nền thay thế (màu, ảnh hoặc video).

**Học chuyển động → nhân vật 3D** (nút hình người trên thẻ video)
- MediaPipe Pose đọc từng khung hình, ghi lại 33 khớp cơ thể của một người (chạy trong trình duyệt, miễn phí).
- Clip "Chuyển động" trên timeline điều khiển nhân vật 3D dựng bằng three.js + `@remotion/three`: kiểu ma-nơ-canh / neon / khung dây, màu, góc máy, lật gương, nền phía sau.
- Video nên thấy rõ toàn thân một người. Nhân vật làm theo động tác cơ thể; ngón tay và biểu cảm khuôn mặt không được ghi lại.

**Nhân vật 3D dựng bằng Blender**
- Kiểu mặc định của clip chuyển động là **Nhân vật Blender**: nhân vật có tóc, mắt, áo hoodie, quần, giày, khung xương đầy đủ (`assets/characters/flow-character.glb`), dựng bằng script `blender/build_character.py`.
- Chuyển động MediaPipe được gắn vào từng xương (hông, ngực, cổ, đầu, tay, chân), kể cả hạ người khi ngồi hoặc ngồi xổm.
- Dùng nhân vật của riêng bạn: tải file `.glb` có khung xương lên Thư viện, rồi chọn trong mục **Nhân vật** của cảnh. Hỗ trợ tên xương của script này và của Mixamo (`mixamorig:Hips`, `LeftArm`, `LeftForeArm`…).

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
| `REMOTION_GL` | Bộ dựng WebGL khi render cảnh 3D: `angle` (mặc định, dùng GPU) hoặc `swangle` (phần mềm, cho máy chủ không có GPU) |
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

## Dựng nhân vật với Blender và mcp-for-blender

Script `blender/build_character.py` dựng một nhân vật hoàn chỉnh (thân, đầu, quần áo, khung xương, gán trọng lượng da) rồi xuất GLB. Màu sắc chỉnh trong `CONFIG` ở đầu file.

- **Qua mcp-for-blender** (Claude điều khiển Blender trên máy bạn): cài theo hướng dẫn của repo mcp-for-blender, mở Blender, rồi nhờ Claude: *"Chạy script blender/build_character.py bằng execute_blender_code, đổi áo thành màu xanh lá, xuất ra assets/characters/flow-character.glb"*. Claude cũng có thể sửa hình dáng, thêm phụ kiện, hoặc dùng các công cụ tạo/tìm mô hình 3D của mcp-for-blender rồi gắn khung xương và xuất GLB.
- **Dòng lệnh:**

```bash
blender --background --python blender/build_character.py -- assets/characters/flow-character.glb
```

- **Nhân vật có sẵn từ nơi khác:** gắn khung xương (ví dụ bằng Mixamo), xuất GLB, rồi tải lên Thư viện của Flow Studio.
