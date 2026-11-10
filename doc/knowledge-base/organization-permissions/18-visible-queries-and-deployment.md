# 第 18 期：受限账号查询与生产部署准备

日期：2026-11-10。用户准备生产服务器期间继续完善日常使用功能，并按约定将本期需求、设计及验证结果保存到本地知识库。

## 需求与验收范围

第 14—17 期已经验证字段/记录隔离与部门撤权，但受限账号的非空排序、分组和搜索被整体拒绝，影响日常使用。本期开放可见字段上的个人筛选、排序、分组和搜索，同时覆盖搜索计数、匹配单元格、分组点与记录位置这些配套入口。隐藏字段与范围外记录不能通过任何新增入口被推断。

生产侧提供本仓库定制版单机部署材料、密钥配置生成器、备份脚本及恢复/验收步骤。服务器尚未交付，本期不把配置校验解释为生产部署完成。

## 设计

- 仍在 Nest 组织权限 HTTP 边界实现，不向 v2-core 注入组织、部门或目录概念，不增加迁移。
- 使用现有 `contentQueryBaseSchema` 解析请求条件，检查每个显式排序/分组字段的 ID；隐藏字段、未知字段和别名不能进入查询。
- 筛选按结构递归检查左右两侧字段引用，跨表引用拒绝。文本值中出现隐藏字段名称不再被当作字段引用误拒绝；非法输入返回 400，越权引用返回 403。
- 对“全部字段”搜索生成明确的可见字段 ID 列表，按调用者 projection 进一步收窄，拒绝空搜索范围。该列表随 search tuple 进入所有服务，避免 search-count/group-points 等契约丢弃 projection 后搜索隐藏字段。
- 所有新增查询继续 AND 本人/直接部门创建者条件，强制忽略共享视图内置条件，移除未经本次检查的 queryId。聚合缓存使用处理后的查询参数，创建者范围和搜索字段列表参与缓存键。
- 新开放 row-count、group-points、search-count、search-cell-count、search-index、search-matches；record-index 在约束查询前额外检查目标记录归属。通用聚合、selection、日历等未审查入口仍拒绝。
- 表权限响应增加可选 `dataRestrictionsEnabled`。受限页面自动启用个人视图并禁止关闭，筛选/排序/分组保留在该浏览器的个人视图，不写共享视图；界面说明同步更新。

## 实现位置

- 后端：`apps/nestjs-backend/src/features/organization/authority-matrix/table-data-access.{service,interceptor}.ts` 及对应单测。
- 前端：`apps/nextjs-app/src/features/app/blocks/view/View.tsx`、`tool-bar/components/PersonalViewSwitch.tsx`、中英文矩阵说明。
- 契约：`packages/openapi/src/table/get-permission.ts`。
- 真实验收：扩展 `apps/nestjs-backend/scripts/verify-community-permissions.cjs`，新增多记录双向排序、分组计数、位置查询、搜索结果/计数/匹配扫描以及隐藏值与外部记录对照。
- 部署材料：[操作说明](../../../deploy/organization-community/README.md)（仓库根目录下 `deploy/organization-community/README.md`），包含 Compose、环境变量模板、nginx 示例、配置生成器和一致性备份脚本。

## 验证记录

仅连接本地独立开发库 `teable_dev_20261109`；验收账号、目录和空间均为合成夹具，不触发真实钉钉同步，不修改真实员工。

| 检查                          | 结果                | 证据                                     |
| ----------------------------- | ------------------- | ---------------------------------------- |
| 组织权限、HTTP 与实时边界单测 | 19 文件、216 项通过 | [日志](assets/18-unit.log)               |
| v1 真实接口                   | 91 项通过、exit 0   | [日志](assets/18-query-v1.log)           |
| v2 真实接口与 Chrome          | 104 项通过、exit 0  | [日志](assets/18-query-v2-browser.log)   |
| 后端完整 typecheck            | 0 错误、exit 0      | [日志](assets/18-backend-typecheck.log)  |
| 前端完整 typecheck            | 0 错误、exit 0      | [日志](assets/18-frontend-typecheck.log) |
| 本期后端/前端改动文件 oxlint  | 无诊断、exit 0      | 本地检查；不代表全仓 lint 清零           |
| 本期代码与部署文件 oxfmt      | 11 文件通过         | 本地检查                                 |

Chrome 中实际点击排序与分组的 Name 字段、输入 my-row，核对 SockJS 记录查询及相同 ID 的成功回复；自动个人视图开启且开关禁用，页面无 JavaScript 异常或开发错误覆盖层。[最终截图](assets/18-personal-queries.png) 中同时显示排序(1)、分组(1)、my-row 搜索与唯一匹配记录。

最终只读核对：真实企业目录 196 部门、334 员工、1 人绑定；合成账号、连接和验收空间均为 0，`/health` 返回 200。[状态记录](assets/18-final-state.log)。[部署离线检查记录](assets/18-deploy-checks.log)。

部署侧完成 Compose 离线解析、环境生成及 0600 权限、密钥独立随机值与 16 字节 AES 参数、拒绝覆盖已有配置、脚本语法检查。通过模拟 Docker 验证备份的停止/采集/恢复启动顺序、失败后恢复启动、失败目录无 COMPLETE、拒绝覆盖备份；该模拟不等于真实数据库与附件恢复演练。

开发热更新曾在浏览器验收期间重启服务，导致该次导航失败。已经完整重启服务，并单独删除该次遗留的已知合成空间；失败的中间运行不计为通过。

## 生产交付边界

- 必须从含全部定制代码的工作区构建镜像，上游官方镜像没有目录/矩阵功能。当前 Git HEAD 不能代表所有未提交定制内容，应同时留存源码快照及镜像摘要。
- 当前本地真实目录约 334 人、196 部门，仅 1 人绑定账号；业务角色、资源成员及矩阵仍需按实际使用范围配置。
- 正式 Linux 镜像构建、服务器 TLS/WebSocket、实际备份恢复、并发压测、监控告警与正式账号试点尚待目标服务器完成。没有服务器性能和全员生产可用性结论。
- 迁移数据库时保留实际生效的加密密钥及旧密钥回退；不得直接用新实例随机密钥替换已有密文对应的密钥。真实密钥不写入知识库。
- 导出、SQL、通用聚合、跨表写入、未支持的批量操作继续受限，后台插件/内部任务全路径仍未取得生产认证。既有权限预检与业务写入不在同一事务中的限制保持如前期记录。
