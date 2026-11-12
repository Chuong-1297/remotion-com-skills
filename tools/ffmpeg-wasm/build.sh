#!/usr/bin/env bash
# Builds Flow Studio's FFmpeg WebAssembly converter (WebM -> MP4 with H.264 + AAC).
# Output: out/webm2mp4.js, out/webm2mp4.wasm (+ convert-worker.js), single-threaded so it runs
# in pages without cross-origin isolation (no SharedArrayBuffer needed).
#
# Requirements: Emscripten (tested with 6.0.12, `source emsdk_env.sh` first), make, pkg-config.
# Sources:
#   FFMPEG_SRC  path to FFmpeg source (tested with Chuong-1297/FFmpeg at commit c0c7f33)
#   X264_SRC    path to x264 source (tested with x264 0.165.3223 git 0480cb0)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FFMPEG_SRC="${FFMPEG_SRC:?set FFMPEG_SRC to the FFmpeg source directory}"
X264_SRC="${X264_SRC:?set X264_SRC to the x264 source directory}"
WORK="${WORK:-$HERE/build}"
PREFIX="$WORK/prefix"
OUT="$HERE/out"
mkdir -p "$WORK/ffbuild" "$OUT"

# 1) x264: static, C only, 8-bit 4:2:0
(cd "$X264_SRC" && emconfigure ./configure --host=i686-gnu --enable-static --disable-cli --disable-asm \
  --disable-thread --disable-opencl --enable-pic --bit-depth=8 --chroma-format=420 \
  --prefix="$PREFIX" --extra-cflags="-O3 -msimd128" && emmake make -j"$(nproc)" && emmake make install)

# 2) FFmpeg libraries: only what WebM/MP4 -> MP4 (H.264 + AAC) needs
(cd "$WORK/ffbuild" && EM_PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" emconfigure "$FFMPEG_SRC/configure" \
  --prefix="$PREFIX" --target-os=none --arch=x86_32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm --pkg-config=pkg-config --pkg-config-flags=--static \
  --disable-asm --disable-inline-asm --disable-x86asm --disable-pthreads --disable-w32threads --disable-os2threads \
  --disable-autodetect --disable-network --disable-everything --disable-programs --disable-doc --disable-debug \
  --disable-runtime-cpudetect --enable-gpl --enable-libx264 --enable-small \
  --enable-protocol=file --enable-demuxer=matroska,mov,ogg,wav --enable-muxer=mp4,mov \
  --enable-decoder=vp8,vp9,opus,vorbis,h264,aac,pcm_s16le,pcm_f32le \
  --enable-parser=vp8,vp9,opus,h264,aac,vorbis --enable-encoder=libx264,aac \
  --enable-filter=buffer,buffersink,abuffer,abuffersink,format,aformat,aresample,scale,null,anull,setsar \
  --enable-swscale --enable-swresample --enable-avfilter \
  --extra-cflags="-O3 -msimd128 -I$PREFIX/include" --extra-ldflags="-L$PREFIX/lib" \
  && emmake make -j"$(nproc)" && emmake make install)

# 3) Converter program, as an ES5 module factory for a Web Worker
LIBS="-L$PREFIX/lib -lavformat -lavfilter -lavcodec -lswscale -lswresample -lavutil -lx264 -lm"
emcc -O3 -msimd128 -I"$PREFIX/include" "$HERE/webm2mp4.c" $LIBS \
  -sMODULARIZE=1 -sEXPORT_NAME=createWebm2Mp4 -sENVIRONMENT=worker \
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2GB \
  -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -o "$OUT/webm2mp4.js"
cp "$HERE/convert-worker.js" "$OUT/"

# Optional: a Node build for testing:  node out/webm2mp4-node.js in.webm out.mp4 [crf] [preset] [audio_kbps]
emcc -O3 -msimd128 -I"$PREFIX/include" "$HERE/webm2mp4.c" $LIBS -sALLOW_MEMORY_GROWTH=1 -sNODERAWFS=1 -sEXIT_RUNTIME=1 -o "$OUT/webm2mp4-node.js"
echo "Built $OUT/webm2mp4.js and $OUT/webm2mp4.wasm"
