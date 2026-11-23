# Docker 集成测试

使用已构建的 DSH Web 0.2.2-rc.1 镜像从一次性 profile 运行，并把镜像名传给下列命令。镜像需带有 pnpm、Node.js 以及位于 `/opt/dsh` 的 Web CLI。测试挂载项目内测试文件及发布包，合成凭据只写容器 tmpfs。在容器回环地址提供归档与 DSH 页面，模拟 Codex 目录，运行身份校验、HTTP 查询及配置保存。

```sh
docker run --rm --network none --tmpfs /data \
  --mount "type=bind,src=$PWD/tests/smoke,dst=/qa,readonly" \
  --mount "type=bind,src=$PWD/releases/dsh-bundle-codex-tools-0.1.0.tgz,dst=/artifact/pkg.tgz,readonly" \
  --entrypoint /bin/sh "$DSH_IMAGE" /qa/run.sh
```
