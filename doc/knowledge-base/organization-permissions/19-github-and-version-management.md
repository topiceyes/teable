# 第 19 期：GitHub Fork 与首版版本约定

日期：2026-11-10。

## 用户需求

使用 GitHub 管理项目，Fork 原始 Teable 项目，定制版首个版本确定为 **1.0.0**。部署前先明确版本规则。

## 设计和执行

- Fork 仓库：[topiceyes/teable](https://github.com/topiceyes/teable)，通过 GitHub API 核对 `fork=true`、父仓库为 `teableio/teable`。
- 本地 `origin` 对应个人 Fork，`upstream` 对应原项目；默认推送目标为个人 Fork。仅调整远程配置和跟踪关系，不变更当前工作区代码历史。
- 根目录新增 `VERSION`，值为 `1.0.0`。定制产品编号与上游 workspace 的 `1.10.0` 包版本独立；保留内部依赖版本，不运行上游 npm 发布脚本。
- 正式 Git 标签采用 `custom-v1.0.0`，GitHub Release 标题和镜像版本采用 `1.0.0`；后续使用 1.0.1 / 1.1.0 / 2.0.0 区分修复、兼容功能及不兼容变更。标签只在发布提交验收完成后创建，不移动正式标签。
- 计划采用 main 稳定分支、develop 集成分支及 PR 管理；本次保持当前 develop 工作区，尚未建立远程 main 或分支保护。
- 部署示例镜像改为 `teable-organization:1.0.0`，构建命令从 `VERSION` 读取 BUILD_VERSION，应用构建信息随之使用定制版本。
- 每期需求、设计、测试和部署记录继续保留在仓库内知识库，随审查后的代码纳入 GitHub 管理。

完整规则见[版本管理约定](../../design/version-management.md)，首版功能及待办见[1.0.0 发布说明草稿](../../releases/1.0.0.md)。

## 验证与当前边界

已核对 GitHub Fork 身份、原项目来源、VERSION 内容及部署示例对应版本，执行文档格式和链接检查。本期不改变应用业务逻辑，无需重复第 18 期全套权限回归。

Fork 创建不等于本地定制代码已经上传。现有改动保留在工作区，尚未批量暂存、提交或推送；上传前需审查所有源码、文档、日志及截图，并先处理继承的上游发布流水线目标。正式 1.0.0 的标签、Release、生产镜像和生产部署均待验收流程完成。
