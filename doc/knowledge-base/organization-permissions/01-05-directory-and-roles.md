# 第 01—05 期：组织目录与业务角色（回溯归档）

归档日期：2026-11-09。以下基于本任务已完成的代码和测试记录补录。

## 需求与设计

社区版原权限矩阵只有企业版提示。先建立企业身份与业务角色，后续由矩阵配置资源权限。钉钉提供组织事实，Teable 决定业务权限。组织信息不进入 v2 Table 领域，不把来源角色直接转换为 owner/editor 等协作者角色。

## 分期交付

1. 目录基础：DirectoryConnection、Department、Member、Membership、SyncRun；一人多部门、本地账号可选绑定、跨企业复合外键约束；完整快照结构校验。完成时记录 8 项测试通过，并验证迁移 SQL。
2. 手动同步：服务端环境配置、分页抓取部门/员工/来源角色、差异预览及指纹确认、事务和企业级 advisory lock、同步日志及脱敏错误。完成时记录 28 项组织测试通过。
3. 绑定与查询：管理员显式绑定和解绑、expectedUserId 比较更新、跨企业查询隔离、实时身份状态校验、部门路径和分页。完成时记录 52 项组织测试通过。
4. 管理页面：管理员入口 `/admin/directory`；企业切换、预览审阅、绑定候选账号搜索、部门浏览和日志。完成时记录前端 7 项、后端 55 项测试通过，前端全量类型检查通过。
5. 业务角色：部门/子部门及来源角色匹配；规则采用任一匹配；角色版本比较更新、启停、有效成员预览及实时身份解析。完成时记录前端 9 项、后端 67 项测试通过；前端全量类型检查通过；新增迁移在 PGlite 验证。

以上为各期完成时的结果，未声称重新运行全部历史验证。后端全量类型检查存在其他文件的既有报错，组织新增文件未报告类型错误。

## 实现入口

- 数据库：`packages/db-main-prisma/prisma/postgres/schema.prisma`；迁移 `20261109000000_add_organization_directory`、`20261109010000_add_directory_business_roles`。
- 后端：`apps/nestjs-backend/src/features/organization/`。
- 契约：`packages/openapi/src/organization/`。
- 前端：`apps/nextjs-app/src/features/app/blocks/admin/directory/` 和 `src/pages/admin/directory.tsx`。
- 中英文文案：`packages/common-i18n/src/locales/{zh,en}/common.json`。

## 部署与限制

迁移尚未应用到实际数据库，真实钉钉企业尚未联调。部署需顺序应用两份迁移、生成 Prisma Client、配置 BACKEND_DINGTALK_DIRECTORY_CONNECTIONS、重建并启动服务。管理员核对应用归属和完整通讯录读取范围后方可同步。

已实现身份和角色归属，不授予表权限，不自动撤销独立协作者授权；扫码登录、定时同步、字段及行级权限尚未实现。后台进程异常退出的 running 日志暂无自动恢复。详细配置、接口和边界见累计架构文档。
