# 第 15 期：综合回归与权限边界补强

日期：2026-11-10。需求：对近期组织目录、钉钉配置、角色映射、权限矩阵、实时撤销、权限预览和字段/记录限制做综合测试；修复发现的问题，复测并在本地知识库归档。

## 结论

本轮后端扩大回归 79 个文件、912 项通过；SDK 全量 107 个文件、748 项通过；前端目录与矩阵 2 个文件、19 项通过，共 1,679 项自动化测试。最终重构后的三个边界测试文件单独复测 41 项通过，这 41 项属于前述后端测试，不重复累计。

真实本地验收：v1 为 62 项通过，v2 加 Chrome 页面验收为 71 项通过。两个引擎分别验证，不把两轮相同场景累计成新增自动化用例。所有验收脚本最终退出码为 0。

修复了数据库复制源检查、初次实时查询回复鉴权、实时批量记录检查、多层关联传播、字段名称与 DTO 结构键冲突五类边界问题。修改已加载到本地开发服务，最终健康检查为 HTTP 200。

## 测试范围与数据原则

- 后端覆盖组织目录全部测试，以及认证/权限、记录、选择粘贴、聚合、表操作、ShareDB 和日志脱敏的相关现有单元测试。包含钉钉读取适配器、配置加密、预览版本、同步锁、绑定冲突、部门层级、角色映射和撤销逻辑。
- 真实 HTTP 验证协作者与矩阵追加权限、跨表写入副作用、手工权限保留、管理员预览及普通用户拒绝、本人/部门记录范围、隐藏/只读字段和批量拒绝。
- 真实 SockJS WebSocket 验证已有订阅在访问撤销后停止投递；ShareDB 客户端/服务端单元测试另覆盖账号停用、会话失效、初次查询回复与存储失败。
- Chrome 验证钉钉配置弹窗、部门导航、矩阵限制编辑器、预览结果及受限用户表格；确认收到本人记录快照，未收到其他创建者的敏感值，无 pageerror 和 Runtime Error 浮层。
- 真实数据测试固定连接本机 `teable_dev_20261109`。所有写测试使用随机临时账号、空间、数据库、角色和企业目录；真实企业目录只读核对，没有重新发起真实钉钉同步，也没有改变真实角色、员工绑定和权限策略。

## 发现与设计修正

| 问题                                                                          | 修正及回归证据                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 复制数据库使用 `fromBaseId`，原检查主要读取目标 `baseId`；源与目标可不同      | 分别检查所有源/目标数据库 ID。即使目标可写，只要源受限，普通账号的 duplicate 和 duplicate-stream 都拒绝。单元测试验证同时检查不同源、目标；真实验收临时授予目标空间权限，验证两条复制路径均返回 403。 |
| ShareDB 初次 `qs/qf` 回复省略集合名，发送边界无法只依靠消息的 `c` 判断资源    | 原请求按 ID 关联集合，初次回复与后续 diff 均查回集合并重新鉴权。真实 ShareDB 测试确认正常初次结果可到达，撤销后初次结果不会送达。                                                                     |
| 仅检查顶层文档 ID 不覆盖初次查询、插入 diff、bulk fetch/subscribe             | 从对应消息形状提取全部文档 ID，对记录再次执行当前创建者范围检查；字段查询同样拒绝隐藏字段。范围外目标导致整条消息停止投递。新增五种记录消息及隐藏字段查询回归。                                       |
| 直接关联保护无法覆盖 A → B → 受限 C，conditional lookup 也可能不依赖普通 link | 沿有效 link、lookup、conditional lookup 引用求闭包，包含跨数据库引用和循环。保护传播同时供表读取、数据库复制、导出及实时数据边界使用。单元测试验证逆序多层引用、跨库过滤和循环终止。                  |
| 隐藏字段名可以是 `id` 等结构键，全对象按名称递归删除会破坏记录和附件 DTO      | 字段名称及数据库列名别名只在单元格字段映射中删除；字段 ID 仍用于元数据映射清理。整体替换 `fields` 的实时 op 分别处理新旧映射，保持共享原值不变。测试确认记录 ID 和附件 ID 保留、隐藏别名被移除。      |

相关实现：

- `apps/nestjs-backend/src/features/organization/authority-matrix/table-data-access.interceptor.ts`
- `apps/nestjs-backend/src/features/organization/authority-matrix/table-data-access.service.ts`
- `apps/nestjs-backend/src/share-db/document-authorization.ts`
- 上述文件对应的 `.spec.ts`，以及扩展的 `apps/nestjs-backend/scripts/verify-community-permissions.cjs`。

验收脚本另外检查普通用户不能列出/保存/测试钉钉连接、管理员列表不返回 AppSecret、直接删除他人记录被拒绝、混合归属批量更新不产生部分写入、混合快照拒绝、按名称写只读字段拒绝、排序/分组/搜索旁路拒绝、导出拒绝。夹具清理失败会使脚本失败，不能打印成功后静默忽略。

## 执行与结果

工具链：Node 24.22.2、pnpm 12.11.2，使用 `/private/tmp/teable-upgrade-toolchain/bin`。测试命令中的路径以下均相对仓库根目录。

| 验证                              | 结果                                                     | 运行记录                                                     |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| 后端扩大回归                      | 79 文件 / 912 项通过，132.59 秒                          | `/tmp/teable-local-run/comprehensive-backend-final.log`      |
| 后端最终边界复测                  | 3 文件 / 41 项通过                                       | `/tmp/teable-local-run/comprehensive-final-fixes.log`        |
| SDK 全量                          | 107 文件 / 748 项通过                                    | `/tmp/teable-local-run/comprehensive-sdk.log`                |
| 前端目录与矩阵                    | 2 文件 / 19 项通过                                       | `/tmp/teable-local-run/comprehensive-frontend.log`           |
| v1 真实验收                       | 62 项，通过并清理夹具                                    | `/tmp/teable-local-run/comprehensive-acceptance-v1.log`      |
| v2 + Chrome 验收                  | 71 项，通过并清理夹具                                    | `/tmp/teable-local-run/comprehensive-acceptance-v2.log`      |
| 前端完整类型检查                  | 通过                                                     | `/tmp/teable-local-run/comprehensive-frontend-typecheck.log` |
| 后端完整类型检查                  | 未通过：249 条既有诊断、363 行输出；本轮相关文件没有诊断 | `/tmp/teable-local-run/comprehensive-backend-typecheck.log`  |
| 修改代码与验收脚本 oxlint / oxfmt | 通过                                                     | 7 个修改文件                                                 |
| `git diff --check`                | 通过                                                     | 仓库现有改动均保留                                           |

后端类型诊断与第 14 期逐项比较，没有新增诊断；输出差异仅为一处 Axios 联合类型的属性显示顺序。不能据此宣称全仓类型检查通过。

首轮扩大测试受沙箱影响，Apple 回调监听本机端口失败，另有缓存连接日志引发测试退出清理错误。复跑使用内存缓存，明确固定开发库，并允许本地临时监听，最终 79 个文件全部通过且无 Vitest unhandled error。第一次服务重启的 45 秒健康等待不足，服务随后完成冷编译；实际验收及最终健康检查均正常。

后端扩大回归选择器：

```sh
cd apps/nestjs-backend
pnpm exec vitest run src/features/organization src/features/auth src/features/record \
  src/features/selection src/features/aggregation \
  src/features/table/open-api/table-open-api.service.spec.ts \
  src/share-db src/logger/redact.spec.ts --maxWorkers=3
```

该命令的最终运行包装器为 `/tmp/teable-local-run/regression-backend.cjs`：加载本地环境后强制数据库 URL 指向开发库，并设置 `BACKEND_CACHE_PROVIDER=memory`。重跑前须保持这两项约束，不直接沿用默认数据库配置。

真实验收脚本从 stdin 读取管理员密码，密码与会话不保存到知识库：

```sh
TEABLE_ACCEPTANCE_MODE=v1 node apps/nestjs-backend/scripts/verify-community-permissions.cjs
TEABLE_ACCEPTANCE_MODE=v2 TEABLE_ACCEPTANCE_BROWSER=1 \
  node apps/nestjs-backend/scripts/verify-community-permissions.cjs
```

## 最终状态与截图

只读核对真实企业示例企业：196 个有效部门、334 名有效员工、1 个本地账号绑定，与测试前一致。临时空间、临时用户、临时企业连接数量均为 0；`GET http://localhost:3000/health` 返回 200。

已复制验收截图到知识库，避免临时目录清理后丢失证据：

- [权限预览及限制编辑器](assets/15-authority-matrix.png)
- [普通用户受限表格](assets/15-restricted-table.png)

截图使用临时夹具，显示本人的两条记录、Name/Locked/Creator 三列，隐藏字段和关联字段没有出现。截图已人工查看。

## 仍保留的边界

第 14 期首版限制继续适用。受限 SQL、导出、搜索/排序/分组、位置粘贴、upsert 等入口仍采取拒绝策略；本轮验证拒绝有效，没有新增这些功能的细粒度支持。

没有重新调用真实钉钉同步或模拟远端权限变化，真实平台接口由既有适配器测试及本次后台只读页面检查覆盖；没有完成生产 BYODB、全部后台任务/第三方插件、长时间压力或事务级并发撤销验收。已公开或下载的独立副本不能追溯收回。关联闭包采取保守隐藏，尚未做大规模依赖图性能基准。通过本地综合回归不代表全部生产通道已经审计。
