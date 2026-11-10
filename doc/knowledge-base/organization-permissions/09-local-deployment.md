# 第 09 期：本地部署与启动验证

日期：2026-11-09（Asia/Shanghai）。

## 需求

将当前累计代码在本机运行起来，应用目录和权限矩阵迁移，提供可登录查看的地址。本次为本地开发部署，不是生产发布或真实钉钉联调。

## 环境核对

现有 Teable 开发服务使用独立 PostgreSQL 数据库 `teable_dev_20261109`。先读取默认开发配置时发现默认库没有迁移历史，随后核对现有启动脚本 `/tmp/teable-local-run/run.cjs`，确认真实服务使用上述独立库；没有对默认 `teable` 数据库执行写入或迁移。

本机 PostgreSQL 和 Redis 已运行。独立库迁移历史完整，待执行的恰好是本项目三份迁移。保留已有用户和管理员，不重置密码、不创建额外管理员。

## 部署操作

1. 使用 pg_dump custom 格式备份独立库。
2. 对独立库执行 Prisma migrate deploy，顺序应用：
   - `20261109000000_add_organization_directory`
   - `20261109010000_add_directory_business_roles`
   - `20261109020000_add_table_authority_policy`
3. 重新生成 Prisma Client。
4. 终止已确认属于本地 Teable 的旧开发进程，确认 3000/3001 端口释放，再用现有启动器运行当前代码。
5. 验证健康状态、登录页及未登录访问限制。

实际备份位置：

`/tmp/teable-local-run/backups/teable-dev-before-directory-2026-11-09T11-17-03-128Z.dump`

备份文件权限为 0600，目录为私有临时目录。该文件不提交到仓库；临时目录可能由系统清理，不能视为长期备份。

## 当前访问与运行方式

- 系统：`http://localhost:3000`
- 登录：`http://localhost:3000/auth/login`
- 组织目录：`http://localhost:3000/admin/directory`，要求实例管理员。
- 权限矩阵：已有数据库页面中的权限矩阵入口，地址 `/base/<baseId>/authority-matrix`；配置要求实例管理员。
- socket 端口：3001。
- 运行日志：`/tmp/teable-local-run/server.log`。
- 本次启动信息：`/tmp/teable-local-run/directory-deployment.json`。
- 启动方式：`/private/tmp/teable-upgrade-toolchain/bin/node /private/tmp/teable-local-run/run.cjs dev`。应在确认原实例已停止后启动，避免端口冲突；现有实例已在后台运行，无需重复启动。

使用现有的临时 Node 24.22.2、pnpm 12.11.2 工具链。启动脚本使用开发模式、Rspack 热更新和 TS_CHECKER=off；独立类型检查结果见先前分期记录，不能把开发启动视为生产构建通过。临时启动器和工具链不保证系统重启后保留，也未注册系统自启动服务。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| GET /health | 200，metaDatabase up |
| GET /auth/login | 200 |
| 未登录 GET /admin/directory | 403 |
| 未登录 GET /api/admin/organization/dingtalk/connections | 401 |
| 数据库迁移 | 无待执行及失败项 |
| 新增结构 | 6 个 directory 表及 table_authority_policy 均已存在 |
| 管理员账号 | 独立库保留 1 个有效实例管理员 |

服务已稳定监听 3000/3001。重启首次编译期间端口曾短暂不可用，随后健康检查成功；没有启动第二个并行实例。

已请求 Codex 在本任务右侧浏览器打开登录页。未代替用户登录现有管理员账号，故未声称完成登录后的真实浏览器业务验收。

## 未配置与后续

`BACKEND_DINGTALK_DIRECTORY_CONNECTIONS` 尚未配置，因此登录后的目录页预期显示未配置企业连接。使用企业内部应用的 corpId、appKey、appSecret 完成服务端配置并重启后，再执行完整通讯录预览、同步和账号绑定。不得把真实密钥写入知识库或代码仓库。

本地部署完成不等于真实钉钉同步、生产发布、全量权限端到端或文档 op 流撤销验证完成。下一步可由用户登录检查页面，再提供服务端企业应用配置以进行真实联调。

## 后续维护：账号解锁与密码重置

2026-11-09，按用户明确要求，对当前本地开发库 `teable_dev_20261109` 中的 `admin@example.invalid` 重置密码并解除锁定。采用现有应用的 bcrypt 规则更新密码与盐，确认账号有效，清除该账号的登录锁定和失败次数缓存，并撤销 1 个旧会话。未调整账号的管理员身份。

使用新密码调用 `POST /api/auth/signin` 返回 200，且返回用户与目标账号一致；验证完成后调用 `POST /api/auth/signout` 返回 200，退出测试会话。密码、盐、哈希及会话凭据不写入知识库。

## 2026-11-10：打不开页面排查

用户反馈本地页面打不开。检查时服务进程仍监听 3000/3001，`/health` 返回 200（约 57ms）；日志显示 `/space` 和 `/auth/login` 正在按开发模式编译。首轮检查登录页约 9 秒后返回 200，未登录组织目录返回 403。随后使用独立 Chrome 浏览器检查登录页，约 1.4 秒加载完成，邮箱、密码输入框和登录按钮正常，无页面 JavaScript 错误或本地资源请求失败。本次未重启服务、未修改账号或数据库；现场证据表明当时存在开发页面编译等待，未复现服务退出。
