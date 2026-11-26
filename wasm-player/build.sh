#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "$1")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
git clone --depth 1 --branch n7.1.1 https://github.com/FFmpeg/FFmpeg.git "$WORK/ffmpeg"
cd "$WORK/ffmpeg"
emconfigure ./configure --prefix="$WORK/install" \
  --target-os=none --arch=wasm32 --enable-cross-compile \
  --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=llvm-nm \
  --disable-asm --disable-inline-asm --disable-x86asm \
  --disable-runtime-cpudetect --disable-stripping --disable-autodetect \
  --disable-programs --disable-doc --disable-debug --disable-network \
  --disable-pthreads --disable-w32threads --disable-os2threads \
  --disable-everything --disable-avdevice --disable-avfilter --disable-swresample \
  --enable-avcodec --enable-avformat --enable-avutil --enable-swscale \
  --enable-decoder=h264,hevc --enable-parser=h264,hevc \
  --enable-demuxer=mov --enable-protocol=file \
  --enable-static --disable-shared --extra-cflags="-O3"
emmake make -j"$(nproc)"
emmake make install
emcc "$ROOT/native/decoder.c" -I"$WORK/install/include" -L"$WORK/install/lib" \
  -lavformat -lavcodec -lswscale -lavutil -O3 --no-entry \
  -sMODULARIZE=1 -sEXPORT_NAME=createDecoder -sENVIRONMENT=worker \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=1073741824 \
  -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_RUNTIME_METHODS='["FS","UTF8ToString"]' \
  -sEXPORTED_FUNCTIONS='["_decoder_open","_decoder_close","_decoder_next","_decoder_seek","_decoder_error","_decoder_pixels","_decoder_size","_decoder_width","_decoder_height","_decoder_full","_decoder_bt709","_decoder_pts","_decoder_duration"]' \
  -o "$OUT/decoder.js"
cp "$ROOT"/web/* "$OUT/"
cp COPYING.LGPLv2.1 "$OUT/FFmpeg-LGPL-2.1.txt"
git rev-parse HEAD > "$OUT/ffmpeg-revision.txt"
# Supply exact FFmpeg source and relink inputs with the build artifact.
mkdir -p "$OUT/relink"
git archive --format=tar.gz --output="$OUT/relink/ffmpeg-source.tar.gz" HEAD
emcc -O3 -I"$WORK/install/include" -c "$ROOT/native/decoder.c" -o "$OUT/relink/decoder.o"
cp "$WORK/install/lib/"*.a "$OUT/relink/"
cp "$ROOT/native/decoder.c" "$ROOT/build.sh" "$OUT/relink/"
test -s "$OUT/decoder.wasm"
