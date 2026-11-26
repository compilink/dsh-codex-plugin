# Docker 集成测试

使用已构建的 DSH Web 镜像从一次性 profile 运行，并把镜像名传给下列命令。镜像需带有 pnpm、Node.js 以及位于 `/opt/dsh` 的 Web CLI。测试挂载项目内测试文件及发布包，合成凭据只写容器 tmpfs。在容器回环地址提供归档与 DSH 页面，模拟 Codex 目录，运行身份校验、HTTP 查询及配置保存。

```sh
docker run --rm --network none --tmpfs /data \
  --mount "type=bind,src=$PWD/tests/smoke,dst=/qa,readonly" \
  --mount "type=bind,src=$PWD/releases/dsh-bundle-codex-tools-0.2.0.tgz,dst=/artifact/pkg.tgz,readonly" \
  --entrypoint /bin/sh "$DSH_IMAGE" /qa/run.sh
```


DSH Web 0.2.3-alpha.2 支持运行同一命令时增加 `-e CODEX_AUTH_QA=1`，使用提供商真实交互和本地合成响应复查浏览器登录、取消、设备码及凭据写入。验证在离线容器进行。

若有已装依赖的 DSH 源码，在插件仓库中运行 `node tests/smoke/panel.cjs /path/to/deepseek-harness/node_modules/.pnpm`，用 DSH 的 React 渲染并操作 Web 和桌面来源下的登录、取消及模型更新面板。
