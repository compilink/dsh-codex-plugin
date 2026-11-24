# Codex 登录与模型管理

在 DeepSeek Harness（DSH）里使用 ChatGPT 账号登录 Codex，并从该账号的在线目录选择模型。插件为 DSH Web 添加登录页和独立的模型更新页。选中的模型写入现有 `openai-codex` 提供商，推理继续由 DSH 原生 pi-ai 适配器执行。

## 在线安装

公开版本 `v0.1.0` 针对 DSH Web `0.2.2-rc.1`，要求 Node.js 22.19 或更高版本，并已启用 `llm-pi-ai` 的 `openai-codex` 提供商。插件使用 Web profile 的 connection、authorization、credentials、settings、llm 和 webServer 服务。部署若已升级到区分浏览器和 API 身份的 DSH 版本，需先确认此发行版的浏览器身份检查与该部署兼容。

```sh
dsh plugin --profile web add --ignore-scripts https://github.com/compilink/dsh-codex-plugin/releases/download/v0.1.0/dsh-bundle-codex-tools.tgz
```

重新加载 Web profile 后，登录 DSH，在页面右下角打开「Codex 登录与模型」。从旧版本地登录插件迁移时，先备份 Web profile，再撤下旧插件对 `/local/chatgpt` 的 Cordis 注册，并保留原有数据目录和模型提供商。安装包与校验文件见 [v0.1.0 Release](https://github.com/compilink/dsh-codex-plugin/releases/tag/v0.1.0)。

## 登录并添加模型

1. 在登录页（`/local/chatgpt`）查看凭据状态。如果显示「尚未登录」，点击「使用 ChatGPT 登录」，按 DSH 提供商的提示完成浏览器授权或设备码登录。已有有效凭据时可直接进入下一步。
2. 打开「Codex 模型更新」（`/local/chatgpt/models`），点击「获取最新模型」。列表来自当前登录账号，已配置的模型会标记出来。若目录提供了相应信息，页面还会显示上下文窗口、输入类型和推理强度。
3. 勾选需要的模型，点击「添加选中模型」，然后回到 DSH 的模型选择器切换使用。仅查询目录不会写入配置。个人默认模型和已有会话的模型选择由 DSH 继续管理。

## 配置与凭据

DSH 在自己的持久化凭据存储中维护 `llm-pi-ai/openai-codex` 授权记录。按需续期时，插件在 DSH 的记录锁内向官方令牌端点发出请求，并核对续期前后的账号。模型目录查询使用当前账号授权和官方服务地址，使用自定义地址或 `apiKeyEnv` 的提供商配置不能通过此页查询。

目录预览在内存中保留十分钟。预览过期或其他页面已修改配置时，请重新获取目录再保存。保存仅向 Codex 提供商追加选中的模型，保留已有模型的自定义字段。配置原先继承模型目录时，第一次添加会将继承的模型和关联的用户覆盖一并保存到显式列表。基础配置含模型覆盖时，按页面提示先在 DSH 模型设置中合并。

## 开发验证

```sh
npm test
npm pack --ignore-scripts --dry-run
```

本包使用 Node.js 标准库，发布包只含运行代码、界面、Cordis 注册文件与说明。使用合成凭据验证登录权限、目录查询和模型保存的步骤见 [Docker 集成测试](tests/smoke/README.md)。
