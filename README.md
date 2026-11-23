# Codex 登录与模型管理

将 ChatGPT 登录入口和当前账号的在线模型目录装入 DeepSeek Harness Web profile。保留原有的 `openai-codex` 模型提供商，模型推理由 DSH 原生 pi-ai 适配器执行。需要 DSH Web 0.2.2-rc.1 的 connection、authorization、credentials、settings、llm 与 webServer 服务。

## 安装

```sh
dsh plugin --profile web add --ignore-scripts https://github.com/compilink/dsh-codex-plugin/releases/download/v0.1.0/dsh-bundle-codex-tools.tgz
```

让 Web profile 重新加载后，从 DSH 的「Codex 登录与模型」入口打开。部署中如已有占用 `/local/chatgpt` 的本地登录插件，在同一次切换中撤下旧插件的 Cordis 注册。保留其文件、原有数据目录和模型提供商。

## 使用

- **ChatGPT 登录** 位于 `/local/chatgpt`，使用 DSH 自己的 OAuth 登录流程。浏览器与无桌面设备码方式由该提供商提供。
- **Codex 模型更新** 位于 `/local/chatgpt/models`。打开页面可查看已配置数量。点击「获取最新模型」才查询官方账号目录，勾选后点击「添加选中模型」才保存到当前提供商。
- 模型保存使用 DSH 配置服务的版本检查。原模型、其他提供商、个人默认模型和会话选择继续使用现有 DSH 持久化数据。已有的模型行保留自定义字段。目录预览仅保存在内存中，十分钟内有效。
- 需要继承模型目录的账号，首次手动添加会将当前可用模型及其用户覆盖保留到显式列表中。若部署的基础配置强制提供模型覆盖，页面会提示先处理覆盖项。
- 账号由 DSH 的 `llm-pi-ai/openai-codex` 凭据记录管理。需要续期时，插件在 DSH 授权记录锁内请求固定的官方令牌端点，并核对续期账号。请求按需发出，目录、账号凭据和授权回调均不会记录到插件仓库。

## 开发验证

```sh
npm test
npm pack --pack-destination releases
```

本包使用 Node.js 标准库，发布包只含运行代码、界面、Cordis 注册文件与说明。发行文件旁的 `.sha256` 记录其摘要。
