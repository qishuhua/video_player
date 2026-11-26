# H.265 / H.264 WASM Player

独立静态播放器，使用 FFmpeg libavformat + libavcodec 软件解码。原来的 video_player 网页不受影响。

## 功能

- H.264 / H.265 MP4（MOV 解封装），全程 CPU 软件解码，无 WebCodecs、MSE、HEVC 扩展和插件。
- 支持本地文件、HTTP(S) URL；视频在浏览器处理，不上传到服务器。
- Web Worker 独立解码、有界帧队列、PTS 播放时钟、关键帧 seek、0.5/1/2/3 倍速。
- WebGL YUV 渲染，无法建立 WebGL context 时回退 Canvas 2D；无需视频硬解显卡。
- 静态 SVG 叠加，容器全屏及 CSS 全屏回退。

## GitHub Pages

在仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。
然后在 Actions → Build WASM player → Run workflow，勾选 deploy。
工作流构建静态文件并部署整个仓库的静态站点副本，原有页面仍保留。
预计播放器 URL： https://qishuhua.github.io/video_player/wasm-player/

不勾选 deploy 时仅构建并上传 wasm-player-site artifact，方便先测试。
可以解压该 artifact，进入 wasm-player 目录，用任意静态 HTTP 服务托管。
不要双击 file:// 页面，Worker/WASM 需要 HTTP(S)。

参数：?video=URL_ENCODED&autoplay=1&svg=URL_ENCODED
URL 必须经过 URL 编码；跨域 MP4 必须允许本站的 CORS GET，HTTPS 页面不可读取 HTTP 混合内容。
静态 SVG 不做逐帧轨迹同步。

## 本地构建

在固定版本 Emscripten 容器中执行：

    docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:3.1.64 bash wasm-player/build.sh /src/dist/wasm-player
    python3 -m http.server 8080 --directory dist

访问 http://localhost:8080/wasm-player/

## 限制

第一版使用单线程基础 WASM，不要求 SharedArrayBuffer 或 COOP/COEP，适合 GitHub Pages。
整段视频读入 MEMFS，限 128 MiB，面向短告警视频。暂无 RTSP、直播、音频、HTTP Range 渐进下载。
Main10 转换为 8 位显示，不实现 HDR 色调映射。解码流畅度依赖 CPU、码流和浏览器。
没有实测保证 1080p 或三倍速；旧电脑建议先测试 720p/1080p 25fps。
浏览器需支持 WASM、Worker、现代 JS 模块；IE 不支持。

FFmpeg 固定 n7.1.1，LGPL 构建（无 GPL/nonfree 编码器）。构建附带准确版本源码、许可证及可重新链接的对象和静态库。商业分发需核实 LGPL、HEVC 专利等合规义务。
