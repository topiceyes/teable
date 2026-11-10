# 社区版组织权限：单机生产部署准备

适用范围：本仓库定制版、一个应用容器、一个 PostgreSQL、一个 Redis、本地附件存储、宿主机 nginx。本目录是待服务器验收的部署材料；本地只验证了配置解析、脚本及权限功能，尚未完成 Linux 镜像构建、真实 TLS、备份恢复演练和容量测试。

## 服务器准备

- Linux 主机，Docker Engine、Compose、宿主机 nginx，管理员可使用 SSH；确认实际 CPU 架构，构建与其匹配的镜像。
- 独立域名及 DNS、TLS 证书、可访问钉钉 API 的出站 HTTPS、时间同步。
- 持久磁盘和异机备份位置；应用附件、数据库、加密根密钥必须一起保留。镜像构建使用仓库 Dockerfile 中的 8 GiB Node 堆上限，构建资源与运行资源分别评估，尚无实测并发容量承诺。
- 对外只开放 HTTPS 及受限管理 SSH；数据库和 Redis 无宿主端口映射，应用仅绑定 127.0.0.1:3000。此配置的代理信任模型仅适合一个宿主机 nginx 直接接收流量；增加 CDN 或第二层代理时重新配置。

## 镜像和新建实例

必须从包含全部定制代码和四份组织目录迁移的工作区构建；上游官方镜像没有这些改动。保存源码快照、依赖锁文件、镜像 ID/摘要以及本期验收记录，不只记录 Git HEAD（目前有未提交定制代码）。构建前检查 `.dockerignore`：实际凭据只能放在已忽略的 `.env.production.local`，不要把数据库备份或真实密钥放入构建上下文。

```bash
# 仓库根目录；按服务器架构调整 platform。构建可能需要网络下载依赖。
docker build --platform linux/amd64 -f dockers/teable/Dockerfile \
  --build-arg BUILD_VERSION="$(cat VERSION)" -t "teable-organization:$(cat VERSION)" .
# 在另一台机器构建时通过私有镜像仓库或 docker save/load 传输，记录摘要。
cd deploy/organization-community
node init-env.mjs https://你的域名
```

生成器只创建不存在的 `.env.production.local`，0600 权限，所有密钥分别随机生成；终端不输出密钥。编辑镜像地址并将经过审查的 PostgreSQL 15、Redis 7 镜像锁到摘要。示例大版本来自仓库已有部署配置，不表示已检查它们的补丁或漏洞状态。确认 PUBLIC_ORIGIN 与正式 HTTPS 地址一致，再执行：

```bash
docker compose --env-file .env.production.local -f compose.yaml config --quiet
docker compose --env-file .env.production.local -f compose.yaml up -d
docker compose --env-file .env.production.local -f compose.yaml ps
curl --fail http://127.0.0.1:3000/health
```

应用镜像的 `scripts/start.sh` 会先执行元数据库和数据 schema 的 `migrate deploy`；不需要旧的 db-migrate 镜像，不用 `skip-migrate` 绕过失败。检查四份 `20261109*` 目录迁移均已应用。数据库密码及 Redis 密码使用生成的十六进制值，避免 DSN 转义问题。

按照 `nginx.conf.example` 修改域名与证书路径，安装到宿主机 nginx 配置的 http 上下文，执行 `nginx -t` 后重载。该示例覆盖 WebSocket Upgrade、转发协议与长连接超时。生产模式 WebSocket 与 HTTP 使用同一 3000 端口，无需额外公开 3001。Secure Cookie 要求通过正式 HTTPS 地址登录。

Docker 的 `unhealthy` 状态不会自动重启尚未退出的容器；需要运维告警和人工处置。`/health` 当前只检测元数据库，不能代替 Redis、附件和 WebSocket 的业务验收。

## 搬迁当前本地数据

当前开发数据在 `teable_dev_20261109`，不能误导出同机的默认 `teable`。搬迁前停止本地写入，对该库及实际附件目录做一致性备份，并保护实际生效的密钥配置。

**导入已有数据时，不能直接使用新建实例生成的全套新密钥。** 钉钉凭据由 `BACKEND_THIRD_PARTY_CREDENTIAL_ENCRYPTION_SECRET`（缺省回退 SECRET_KEY）加密；同时保留现有 `_OLD` 回退配置。附件令牌、PAT、AI 配置等也有独立密钥，按原环境完整迁移相应值。不要把实际密钥写入知识库或聊天。无法确认旧密钥时先验证解密或重新配置连接，不通过反复重置密码掩盖配置错误。

先在隔离的目标库演练恢复、登录及连接测试，再正式切换。不要让本地和生产两个环境同时写同一数据库或不同步的附件目录。

## 备份和恢复

仅适用于本目录单机拓扑且不存在额外写入程序的场景。备份会短暂停止应用以对齐数据库与附件，结束自动尝试启动应用；失败目录不含 COMPLETE，不作为可用备份。先准备目标父目录，再执行：

```bash
bash backup.sh /安全的绝对路径/teable-20261110-150000
```

产物为数据库 custom dump、完整 .assets 归档、配置及密钥、镜像信息、COMPLETE 标记。备份目录包含敏感数据，仅授权运维可读，并复制到异机。Redis 作为缓存和任务协调使用，不当作业务数据恢复来源；恢复后检查待执行任务及同步状态。

以下恢复命令仅用于**独立的新部署目录及空数据卷**，不得直接对现网执行。使用同版本镜像及备份配置，将 `config.env` 安全复制为 `.env.production.local`（0600），以避免密钥丢失。新目录须设置不同 Compose 项目名（修改 `name:` 或每条命令统一加 `-p teable-restore`），避免连接生产卷。

```bash
docker compose --env-file .env.production.local -f compose.yaml up -d db cache
# 等待 db/cache healthy；在新建空库恢复，任何错误即停止，不忽略报错。
docker compose --env-file .env.production.local -f compose.yaml exec -T db \
  sh -c 'pg_restore --exit-on-error --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < /安全备份目录/database.dump
docker compose --env-file .env.production.local -f compose.yaml run --rm --no-deps -T \
  --entrypoint tar app -C /app/.assets -xzf - < /安全备份目录/assets.tar.gz
docker compose --env-file .env.production.local -f compose.yaml up -d app
```

隔离恢复环境同时修改域名及宿主端口，避免占用生产 3000。记录恢复耗时、数据数量、附件下载、管理员和普通账号权限、钉钉连接解密结果。未做实际恢复演练之前，不能宣称备份可用。数据库迁移不保证支持旧镜像回滚；升级失败时优先保留现场，在隔离环境使用升级前备份和旧镜像恢复，再制定切换步骤。不要使用 `docker compose down -v`。

## 正式开放的验收条件

1. 正式 HTTPS 登录、退出、重启后再次登录成功；设置正式管理员密码，确认邮件/邀请和账号找回的实际使用方式。
2. `/health`、Redis 带认证 PING、WebSocket 101 及持续订阅、附件上传下载通过；确认真实客户端 IP 进入审计日志。
3. 在后台测试钉钉连接并审查同步结果。当前本地目录约 334 人，仅 1 人绑定；其他人员上线前仍需绑定本地账号并配置业务角色、资源成员和权限矩阵，不能把“目录同步成功”当作“全员已有访问权”。
4. 使用试点普通账号验证本人/直接部门记录范围、隐藏/只读字段、个人筛选排序分组搜索、解绑/离职后的下一次访问及既有连接撤权。
5. 按本节完成独立恢复演练，并做预计并发量下的压测，记录响应时间、错误率、连接数和存储增长；设置健康/磁盘/备份失败告警。

权限范围仍有明确限制：受限表的导出、SQL、通用聚合、跨表写入、未审查批量入口等被拒绝；个人筛选、排序、分组不改共享视图。后台内部任务与插件全路径尚未获得正式生产认证。先完成少量人员试点，再扩大使用范围。
