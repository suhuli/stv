# 私人TV - 私人视频查看系统

<div align="center">
  <img src="image/private-tv-logo.svg" alt="私人TV Logo" width="120">
  <br>
  <p><strong>私人视频查看系统</strong></p>
</div>

## 📺 项目简介

私人TV 是一个轻量级的私人视频查看系统，提供来自多个视频源的内容搜索与播放服务。无需注册，即开即用，支持多种设备访问。项目结合了前端技术和后端代理功能，可部署在支持服务端功能的各类网站托管服务上。**项目门户**： [tv.181.cx](https://tv.181.cx)

本项目基于 [bestK/tv](https://github.com/bestK/tv) 进行重构与增强。

<details>
  <summary>点击查看项目截图</summary>
  <img src="https://github.com/user-attachments/assets/df485345-e83b-4564-adf7-0680be92d3c7" alt="项目截图" style="max-width:600px">
</details>

## 🚀 快速部署

通过 Cloudflare Pages 部署，即可快速创建自己的私人TV 实例。

## 🚨 重要声明

- 本项目仅供学习和个人使用，为避免版权纠纷，建议使用 Cloudflare Access 等方式限制访问范围
- 请勿将部署的实例用于商业用途或公开服务
- 如因公开分享导致的任何法律问题，用户需自行承担责任
- 项目开发者不对用户的使用行为承担任何法律责任

## ⚠️ 升级说明

本仓库独立维护，不会自动同步或合并其他仓库的更新。升级前建议先在设置中导出配置；升级后如遇缓存问题，请清除页面 Cookie 并使用 Ctrl + F5 强制刷新。


## 📋 详细部署指南

### Cloudflare Pages

1. 克隆本仓库到您的 GitHub 账户
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)，进入 Pages 服务
3. 点击"创建项目"，连接您的 GitHub 仓库
4. 使用以下设置：
   - 构建命令：留空（无需构建）
   - 输出目录：留空（默认为根目录）
5. 点击"保存并部署"
6. （可选）在"设置" > "环境变量"中配置代理缓存参数，见下文「代理配置」

## 🔧 自定义配置

### 访问控制

项目本身不再内置密码功能。如需限制访问，推荐在 Cloudflare Dashboard 中为 Pages 项目启用 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)（支持邮箱一次性验证码、GitHub 登录等，免费额度足够个人使用）。

### 代理配置

`/proxy/*` 由 Pages Function 提供，可通过环境变量调整（均为可选）：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_CACHE_TTL` | `600` | 采集站搜索 JSON 的缓存秒数 |
| `DETAIL_CACHE_TTL` | `1800` | 采集站详情（剧集列表）的缓存秒数 |
| `MEDIA_CACHE_TTL` | `86400` | 图片等二进制资源的边缘缓存秒数 |
| `M3U8_CACHE_TTL` | `300` | 经代理重写的 m3u8 缓存秒数 |
| `UPSTREAM_TIMEOUT` | `10000` | 回源超时（毫秒） |
| `M3U8_FLATTEN` | `false` | 设为 `true` 时把多码率主列表压平为最高码率（旧行为）；默认保留所有码率由播放器自适应 |
| `MAX_RECURSION` | `5` | 压平模式下主列表递归解析层数 |
| `USER_AGENTS_JSON` | 内置 Chrome UA | JSON 字符串数组，随机选用 |
| `DEBUG` | `false` | 输出调试日志 |

缓存分两级：L1 为 Cloudflare Cache API（单机房），L2 为 CDN 主缓存（`fetch` 的 `cf.cacheTtl`，建议在 Cloudflare 面板 Caching → Tiered Cache 开启 Smart Tiered Cache 以跨机房共享）。不需要绑定 KV。响应头 `X-Proxy-Cache` / `X-Upstream-Cache` 分别表示两级命中情况。


### API兼容性

私人TV 支持标准的苹果 CMS V10 API 格式。添加自定义 API 时需遵循以下格式：
- 搜索接口: `https://example.com/api.php/provide/vod/?ac=videolist&wd=关键词`
- 详情接口: `https://example.com/api.php/provide/vod/?ac=detail&ids=视频ID`

**添加 CMS 源**:
1. 在设置面板中选择"自定义接口"
2. 接口地址: `https://example.com/api.php/provide/vod`

## ⌨️ 键盘快捷键

播放器支持以下键盘快捷键：

- **空格键**: 播放/暂停
- **左右箭头**: 快退/快进
- **上下箭头**: 音量增加/减小
- **M 键**: 静音/取消静音
- **F 键**: 全屏/退出全屏
- **Esc 键**: 退出全屏

## 🛠️ 技术栈

- HTML5 + CSS3 + JavaScript (ES6+)
- Tailwind CSS
- HLS.js 用于 HLS 流处理
- DPlayer 视频播放器核心
- Cloudflare Pages Functions
- 服务端 HLS 代理和处理技术
- localStorage 本地存储

## ⚠️ 免责声明

私人TV 仅作为视频搜索工具，不存储、上传或分发任何视频内容。所有视频均来自第三方 API 接口提供的搜索结果。如有侵权内容，请联系相应的内容提供方。

本项目开发者不对使用本项目产生的任何后果负责。使用本项目时，您必须遵守当地的法律法规。

## 🤝 衍生项目

它们提供了更多丰富的自定义功能，欢迎体验~

- **[MoonTV](https://github.com/senshinya/MoonTV)**  
- **[OrionTV](https://github.com/zimplexing/OrionTV)**  

## 🥇 感谢支持

- **[Sharon](https://sharon.io)**
- **[ZMTO](https://zmto.com)**
- **[YXVM](https://yxvm.com)**  
