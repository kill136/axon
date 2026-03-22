# 落地页下载镜像配置

## 背景

当前落地页的下载按钮默认走 `/download/:filename`，服务端再通过 GitHub Release API 拿临时下载地址做 302 跳转。  
这个方案能隐藏私有 release，但**不会改善中国大陆用户的下载速度**，因为最终下载源仍然是 GitHub / S3。

现在下载链路已经支持：

1. 国内镜像直链优先
2. 通用镜像直链其次
3. GitHub Release 代理兜底

## 推荐部署

建议把安装包同步到一个面向中国大陆优化的对象存储或 CDN，然后把落地页环境变量指过去，例如：

- 腾讯云 COS 默认 HTTPS 域名
- 阿里云 OSS + CDN
- 七牛云 Kodo
- Cloudflare R2 + 国内可访问 CDN

如果你想少折腾证书，当前最省事的是腾讯云 COS 默认域名方案，可以看 [docs/tencent-cos-download-mirror.md](/f:/claude-code-open/docs/tencent-cos-download-mirror.md)。

如果你直接使用七牛 Kodo，可以看 [docs/qiniu-download-mirror.md](/f:/claude-code-open/docs/qiniu-download-mirror.md)。

## 环境变量

### 1. 国内镜像基础路径

```bash
DOWNLOAD_MIRROR_CN_BASE_URL=https://download.chatbi.site/axon/
```

当用户命中 `cn` 区域时，请求：

- `/download/Axon-Setup.exe?region=cn`
- `/download/Axon-Setup.dmg?region=cn`
- `/download/Axon-Setup.AppImage?region=cn`

会分别跳到：

- `https://download.chatbi.site/axon/Axon-Setup.exe`
- `https://download.chatbi.site/axon/Axon-Setup.dmg`
- `https://download.chatbi.site/axon/Axon-Setup.AppImage`

### 2. 国内镜像单文件覆盖

如果某个文件想走单独域名，可以配置更细粒度的变量：

```bash
DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL=https://download-cn.chatbi.site/axon/windows/Axon-Setup.exe
```

单文件变量优先级高于 `DOWNLOAD_MIRROR_CN_BASE_URL`。

### 3. 通用镜像

如果你还有一个面向海外或全局的 CDN，可以继续配置：

```bash
DOWNLOAD_MIRROR_BASE_URL=https://downloads.chatbi.site/axon/
```

当国内镜像没配时，会继续尝试通用镜像；都没配时才回退到 GitHub 代理。

### 4. GitHub 兜底

```bash
GITHUB_TOKEN=ghp_xxx
```

只有镜像都没命中时，才会走现在的 GitHub Release 代理逻辑。

## 当前识别规则

下载接口会按下面顺序判断区域：

1. 显式查询参数 `?region=cn|global`
2. `x-vercel-ip-country` / `cf-ipcountry`
3. `Accept-Language`
4. 默认 `global`

中文落地页 `/zh` 的下载按钮已经显式带上 `?region=cn`。

## 发布注意事项

镜像要真正提速，关键不是改页面，而是**发版时同步镜像文件**。至少保证这三个稳定文件名始终可用：

- `Axon-Setup.exe`
- `Axon-Setup.dmg`
- `Axon-Setup.AppImage`

如果镜像只上传版本号文件而没有同步这三个稳定文件名，落地页虽然会命中国内镜像配置，但下载会直接 404。
