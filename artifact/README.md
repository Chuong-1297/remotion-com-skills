# Flow Studio (bản chạy trong Claude)

`flow-studio.html` là trang artifact đăng tại https://claude.ai/artifact/N1np64qtRcVLNUt4tJ3TQy.

Các file đi kèm khi đăng (không lưu trong repo vì dung lượng lớn, tạo lại được):

| Đường dẫn khi đăng | Nguồn |
|---|---|
| `mp/vision_wasm_internal.js`, `mp/vision_wasm_internal.wasm` | `node_modules/@mediapipe/tasks-vision/wasm/` (bản 1.1.1) |
| `models/selfie_segmenter.b64.txt` | base64 của `selfie_segmenter.tflite` (MediaPipe Image Segmenter) |
| `models/pose_landmarker_lite.b64.txt` | base64 của `pose_landmarker_lite.task` (MediaPipe Pose) |
| `characters/flow-character.glb.b64.txt` | base64 của `assets/characters/flow-character.glb` |

Artifact chỉ phục vụ một số loại file, nên model và GLB được gửi dưới dạng văn bản base64 và giải mã trong trang.
Thư viện JavaScript của MediaPipe (`vision_bundle.mjs`) và three.js r147 được tải từ jsDelivr.
