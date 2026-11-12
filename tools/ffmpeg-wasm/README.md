# FFmpeg WebAssembly: WebM → MP4 (H.264 + AAC)

Bộ chuyển đổi Flow Studio dùng để xuất video chuẩn ngay trong trang (artifact trên Claude), không phụ thuộc định dạng mà trình duyệt ghi được.

- `webm2mp4.c` — chương trình chuyển đổi, viết lại từ `doc/examples/transcode.c` của FFmpeg: đọc WebM/MKV/MP4, mã hoá video bằng **libx264** (yuv420p, CRF, preset), âm thanh bằng **AAC**, ghi MP4 có `faststart`, bỏ khung trùng dấu thời gian của MediaRecorder, in `progress=<giây>` để hiển thị tiến độ.
- `convert-worker.js` — Web Worker gọi bộ chuyển đổi để giao diện không bị đứng.
- `build.sh` — build lại từ mã nguồn bằng Emscripten (một luồng, không cần SharedArrayBuffer / cross-origin isolation).

Kích thước: `webm2mp4.wasm` khoảng 3,8 MB, `webm2mp4.js` khoảng 70 KB.

```bash
FFMPEG_SRC=/path/to/FFmpeg X264_SRC=/path/to/x264 ./build.sh
```

**Giấy phép:** bản build có libx264 nên toàn bộ bộ chuyển đổi theo **GPL phiên bản 2 trở lên**. Mã nguồn FFmpeg: repo Chuong-1297/FFmpeg (commit c0c7f33); x264: bản 0.165.3223 (git 0480cb0); cấu hình build và mã chuyển đổi: thư mục này.
