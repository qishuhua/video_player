# video_player

一个零构建依赖的**告警视频回放页面**。适用于从飞书告警卡片等入口跳转，在浏览器中播放 MP4 视频，并在视频上方叠加预先生成的 SVG 检测区域/轨迹图层。

项目当前只有一个 `index.html`，使用原生 HTML、CSS 和 JavaScript 实现，无需前端框架或后端服务即可部署页面。

## 功能

- **URL 参数加载**：从链接传入视频地址、SVG 叠加图层及可选的封面图，不提供页面内地址输入框。
- **视频播放控制**：面向无音轨告警视频，普通模式下将「播放/暂停图标 → 进度条 → 当前时间/总时长 → 倍速 → 全屏图标」排列在视频下方同一行，不显示静音按钮或音量滑块，避免遮挡检测框和轨迹。
- **倍速播放**：仅保留 0.5×、1×、2×、3×，默认 1×。
- **SVG 图层叠加**：可显示/隐藏图层，按 0%～100% 调整透明度。
- **全屏展示**：桌面浏览器优先使用原生全屏，鼠标移至底部唤出控制栏；手机始终采用 CSS 模拟全屏，保留视频、SVG 与网页手势控件在同一层级。手机单击画面唤出控制栏、双击播放/暂停；底部提供细小的触摸唤醒条，约 5 秒后自动隐藏控制栏。
- **移动端适配**：响应式界面、`playsinline` 属性和安全区布局。透明原生按钮负责接收视频区域点击，避免依赖 `<video>` 的触摸事件；触屏优先保留网页内模拟全屏，不触发 iPhone 系统原生视频全屏。
- **错误提示**：视频加载失败、SVG 加载失败、参数格式错误等情况会显示提示。

> **范围说明：** 当前叠加层是通过 `<img>` 加载的**单张静态 SVG**，不会根据播放时间自动切换检测框或轨迹；也**不支持直接传入检测框 JSON**。如果需要逐帧/按时间戳的动态框，必须扩展前端绘制和时间同步逻辑。

## 快速使用

### 1. 本地启动

将仓库克隆到本地：

```bash
git clone https://github.com/qishuhua/video_player.git
cd video_player
```

建议通过 HTTP 静态文件服务打开页面，例如：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://127.0.0.1:8080/?video=视频URL&overlay=SVG_URL
```

也可以将 `index.html` 部署到 Nginx、对象存储静态网站或其他 HTTP(S) 静态文件服务。

### 2. URL 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `video` | 是 | MP4 视频 URL（仅允许 `http://` 或 `https://`） |
| `overlay` | 是 | SVG 叠加图层 URL（仅允许 HTTP(S)） |
| `image` | 否 | 视频封面图片 URL，用作 `poster` |
| `autoplay` | 否 | 设为 `1` 时尝试**静音自动播放**，是否成功由浏览器策略决定 |

> 未传入 `video` 时页面不会加载媒体；传入 `video` 但缺少或传错 `overlay` 会提示参数错误。各 URL 应整体进行 URL 编码，特别是包含对象存储预签名查询参数的链接。

示例：

```text
http://127.0.0.1:8080/?video=https%3A%2F%2Fexample.com%2Falert.mp4&overlay=https%3A%2F%2Fexample.com%2Foverlay.svg&image=https%3A%2F%2Fexample.com%2Fcover.jpg&autoplay=1
```

如果由业务服务构建告警卡片跳转链接，建议通过标准 URL API 自动编码：

```js
const player = new URL("https://your-domain.example/player/");
player.searchParams.set("video", "https://media.example/alert.mp4");
player.searchParams.set("overlay", "https://media.example/overlay.svg");
player.searchParams.set("image", "https://media.example/cover.jpg"); // 可选
player.searchParams.set("autoplay", "1"); // 可选

console.log(player.toString());
```

当页面部署在网站根目录且入口文件为 `index.html` 时，`/player/` 可以替换为实际访问路径。

## Nginx 部署示例

将 `index.html` 放到 `/usr/share/nginx/html/player/index.html`，然后使用如下站点配置：

```nginx
server {
    listen 8080;
    server_name _;

    root /usr/share/nginx/html;

    location /player/ {
        try_files $uri $uri/ =404;
    }
}
```

访问 `http://<服务器地址>:8080/player/?video=...&overlay=...` 即可。

该页面只是播放器，不负责上传、转码、托管视频/SVG，也不会生成预签名 URL；这些任务应由外部业务服务完成。

## 媒体资源要求与常见问题

### 视频能下载却无法播放

网页使用浏览器原生 `<video>`，**可否播放取决于浏览器解码器、视频编码、封装及服务器响应**。推荐在需要广泛兼容时使用 MP4 容器和 H.264 视频编码；存在音轨时可采用 AAC。

资源服务器应返回正确的 `Content-Type`（如 `video/mp4`），避免强制下载（例如 `Content-Disposition: attachment`）。支持 HTTP Range 请求有助于拖动进度播放。HEVC/H.265 是否可播依赖具体浏览器、操作系统与设备，不能仅靠修改文件扩展名解决。

### SVG 显示位置不准确

请确保 SVG 的 `viewBox` / 宽高比例与视频实际画面一致，并使用同一套坐标系。播放器在读取视频元数据后会把容器宽高比调整为视频分辨率比例，视频和 SVG 都使用 `object-fit: contain`。

当前播放器不解析 SVG 内的时间信息，也不根据视频时间改变图层内容。

### OSS / S3 预签名 URL

- 在拼接播放器链接时对媒体 URL **整体编码**，不要手工拼接原始 `&`、`?`。
- 确保链接尚未过期，并允许浏览器访问；过期、鉴权失败或存储策略限制都会导致加载失败。
- 页面通过 `video.src`、`img.src` 直接加载远程资源，不使用 `fetch` 读取响应内容。基础展示通常不需要为 JavaScript 开启跨域读取权限；但服务器的 CSP、CORP、认证及其他访问策略仍可能阻止资源加载。
- 预签名 URL 放在浏览器地址栏查询参数中，可能进入浏览器历史、日志等记录；请控制有效期，不要把长期密钥放在 URL 中。页面设置了 `no-referrer`。

### 移动端全屏与自动播放

移动端原生视频全屏可能让 DOM 叠加层和触摸按钮失效，因此手机端使用 CSS 模拟全屏，保持 SVG 与网页控件可操作；全屏控制栏可单击视频画面或底部细小唤醒条唤出；`autoplay=1` 会尝试静音播放，但不保证浏览器允许自动播放。

## 项目结构

```text
video_player/
├── index.html   # 页面样式、播放器 UI、播放控制与 URL 参数解析
└── README.md    # 使用说明
```

## 技术实现

- 原生 HTML5 `<video>` 实现媒体播放。
- 透明 `<img>` 作为视频上层的 SVG 图层。
- 使用 `URLSearchParams` 解析入口参数。
- 不依赖 Node.js、第三方 JS 库或打包工具。
- 浏览器必须能够访问视频和 SVG 的 HTTP(S) 地址。

## 已知限制

- 仅支持静态 SVG 叠加，不支持随视频时间变化的检测框。
- 不支持 HLS、WebRTC、RTSP 等协议的原生播放适配。
- 不提供资源上传、格式转码、鉴权、预签名生成或后台服务。
- 未提供自动化测试；具体媒体格式与浏览器的兼容性需要实机验证。
