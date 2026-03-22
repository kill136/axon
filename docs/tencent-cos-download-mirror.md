# 腾讯云 COS 下载镜像

这套方案的目标很简单：

1. 每次 GitHub 打 tag 发版后，自动把 `Axon-Setup.exe` 上传到腾讯云 COS
2. 始终覆盖同一个稳定对象键 `Axon-Setup.exe`
3. 落地页和 Web 下载路由只需要配置一次固定镜像地址

## 为什么这套更适合现在

- 腾讯云 COS 默认域名自带 HTTPS，不需要你再给 `cdn.chatbi.site` 单独折腾证书
- 默认域名格式是 `https://<BucketName-APPID>.cos.<Region>.myqcloud.com/`
- Axon 现在的 Windows 安装包是 `exe`，不属于 COS 文档里限制下载的 `apk/ipa`

## 你要准备的东西

### 1. 一个 COS 存储桶

- 地域建议选离用户近的内地地域，例如 `ap-guangzhou`、`ap-shanghai`
- 存储桶权限建议至少能让 `Axon-Setup.exe` 被公网读取
- 存储桶名称必须是完整格式，例如：

```bash
axon-download-1250000000
```

### 2. GitHub Secrets

在仓库 `Settings -> Secrets and variables -> Actions` 里新增：

```bash
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_BUCKET
TENCENT_COS_REGION
```

可选：

```bash
TENCENT_COS_PUBLIC_BASE_URL
TENCENT_COS_OBJECT_KEY
TENCENT_COS_CACHE_CONTROL
```

说明：

- `TENCENT_COS_PUBLIC_BASE_URL` 不填时，脚本会自动生成默认 HTTPS 地址：

```bash
https://<BucketName-APPID>.cos.<Region>.myqcloud.com/
```

- `TENCENT_COS_OBJECT_KEY` 默认就是 `Axon-Setup.exe`
- 推荐保持默认对象键，这样 Railway 里的镜像环境变量只配一次
- `TENCENT_COS_CACHE_CONTROL` 默认是 `no-cache`，保证稳定 URL 覆盖后尽快生效
- `TENCENT_COS_OBJECT_ACL` 默认是 `public-read`，这样即使桶本身是“私有读写”，这个安装包对象也能直接公网下载

## GitHub Actions 现在会做什么

`build-electron-windows` 在生成 `Axon-Setup.exe` 后，会额外尝试：

1. 上传到腾讯云 COS
2. 覆盖对象键 `Axon-Setup.exe`
3. 在 GitHub Actions summary 输出：

```bash
public_url
public_base_url
object_key
sha256
region
bucket
```

如果 COS 的 4 个必填 secrets 没配齐，工作流会跳过 COS 上传，并在 summary 里明确提示。

## Railway 只需要配一次

如果你用 COS 默认域名，Railway 里只要配置一次：

```bash
DOWNLOAD_MIRROR_CN_AXON_SETUP_EXE_URL=https://<BucketName-APPID>.cos.<Region>.myqcloud.com/Axon-Setup.exe
```

以后每次新版本打 tag，GitHub Actions 都会自动覆盖这个对象，Railway 不需要再改。

## 本地手动上传

```bash
node scripts/upload-tencent-cos-installer.cjs release/Axon-Setup.exe
```

或者：

```bash
npm run mirror:upload:cos -- release/Axon-Setup.exe
```

前提是你本地环境里已经设置好上面的 COS 变量。

## 免费说明

今天 2026-03-22 我查了腾讯云官方文档：

- COS 面向首次开通 COS 的新用户提供免费额度资源包
- 默认域名和地域规则见官方“地域和访问域名”文档

这不是“永远 100% 零成本”的承诺，具体额度和是否还在活动期，以你控制台当天展示为准。

## 官方参考

- 免费额度: https://intl.cloud.tencent.com/zh/document/product/436/6240
- 地域和访问域名: https://cloud.tencent.com/document/product/436/6224
- Node.js SDK 上传对象: https://cloud.tencent.com/document/product/436/64980
