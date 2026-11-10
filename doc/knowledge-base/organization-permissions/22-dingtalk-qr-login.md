# 第 22 期：钉钉扫码登录与员工自动绑定

日期：2026-11-10。需求：使用企业钉钉扫码登录，自动关联已有组织目录和本地账号。目标应用版本 1.1.0，保留 1.0.0 的代码标签和运行回退镜像。

## 需求与账户规则

- 后台每个企业连接增加“启用钉钉扫码登录”和“允许首次扫码自动创建普通账号并绑定员工”，均默认关闭；升级迁移不会自动开放登录或注册。
- 已有 employee.userId：检查员工、连接、账号有效后登录该账号；关闭自动开户不影响已绑定账号登录。
- 未绑定员工：企业显式允许开户时创建普通账号并绑定，isAdmin=false，不创建空间、数据库成员或权限策略。业务角色仍由原有目录/矩阵计算。
- 企业 API 返回邮箱与本地既有账号重合：不凭邮箱自动合并。先用旧账号正常登录，在个人设置 → 账户扫码绑定；后续扫码直接登录。已有其他绑定须由管理员核对，不覆盖。
- 企业没有提供邮箱时，使用 connectionId + unionId 的哈希生成 @dingtalk.invalid 内部身份邮箱，关闭该邮箱的通知；不写入虚构手机号、密码或真实邮件地址。
- 只允许已经同步且有效的员工；外部人员、离职、停用账号、系统账号和绑定冲突全部拒绝。当前登录不触发通讯录同步。

## 设计

使用钉钉托管授权页面，不引入前端第三方脚本。流程为 /api/auth/dingtalk/start → 钉钉扫码/授权 → /api/auth/dingtalk/callback → 标准 Passport 登录会话。

1. 后端创建 10 分钟随机 state；独立 HttpOnly、SameSite=Lax 浏览器随机 Cookie 与 state 绑定，HTTPS origin 自动设置 Secure。此 Cookie 不依赖匿名用户会话持久化，避免 Teable 仅保存已登录用户会话的限制。
2. 缓存保存企业、连接配置版本、浏览器凭证和受限站内跳转；首次消费使用原子 setnx，防止并发回调重放。手动关联还绑定原本已认证的 cookie session 与 userId，PAT/JWT 无法调用绑定接口。
3. authCode 换个人 accessToken；获取个人 unionId；用企业 token 的 getbyunionid 得到企业 userid，再查询企业详情，必须 userid/unionId 一致。令牌、授权码和 appSecret 不写入账号或审计数据。
4. 本地按 connectionId + externalId 找员工，校验同步目录中的 unionId 与有效状态。在与同步、手动绑定共用的 PostgreSQL advisory transaction lock 内重新检查配置版本；开户、Account issuer 记录和员工绑定同事务提交。
5. 回调成功使用 req.login 重新建立会话，记录 loginMethod=dingtalk 并保存；错误只返回固定本地化标识，不输出钉钉响应原文。日志同时脱敏 authCode 和 state。

迁移：20261110000000_add_dingtalk_login，为 directory_connection 增加 login_enabled、auto_provision 两列。配置 API 字段为可选，旧客户端不传时保留已有开关。

## 钉钉平台配置

沿用同步目录的同一企业内部应用 AppKey/AppSecret。开放平台“钉钉登录与分享”中登记应用提供的完整回调地址，并开通通讯录个人信息读权限 Contact.User.Read；应用需要具备已经用于同步的企业人员读取权限。回调由服务端 PUBLIC_ORIGIN 生成，不接受浏览器传入回调主机。

官方资料：[网页方式登录应用](https://open.dingtalk.com/document/orgapp/tutorial-obtaining-user-personal-information)、[获取登录用户访问凭证](https://open.dingtalk.com/document/orgapp/obtain-identity-credentials)、[获取通讯录个人信息](https://open.dingtalk.com/document/orgapp/dingtalk-retrieve-user-information)。DWS CLI 在本机不可用，使用官方文档和官方 SDK 接口契约核对；未调用平台配置写接口。

## 构建与部署改进

将第 21 期实测的生产打包修复纳入正式代码：生产 rspack 对 @teable workspace 使用统一源码打包，避免源码和 dist 混用导致 DI Symbol 不同；数据迁移扫描增加容器 /app/packages 候选目录。Dockerfile 使用低并发构建、固定少量 Next 页面 worker、显式 runner BUILD_VERSION 和 UID 1001。原开发目录所有既有变更保留，1.1.0 使用从已发布 1.0.0 创建的隔离工作区。

## 验证结果

- 前后端完整类型检查均通过；新文件定向 lint 无错误。
- 后端受影响回归 219 项通过，5 项真实数据库测试按默认关闭条件跳过；另以显式开关运行钉钉登录数据库/HTTP 验收，包含这 5 项的 31 项测试全部通过。
- 前端管理/登录相关 22 项通过。
- Chrome 实际页面及已认证绑定入口 9 项通过：企业扫码按钮、管理员开关默认关闭、开户开关前置条件、完整回调提示、正常 Cookie 会话绑定入口和无 JS 错误。截图已人工查看，全部为合成资料；结束清理合成账号及企业。
- 身份适配器使用模拟钉钉响应验证实际请求契约、unionId/userid 企业一致性、外部人员拒绝和敏感错误脱敏。真实数据库验证开户/绑定/issuer 同事务、旧邮箱不合并、账号复用、事务回滚和单企业唯一绑定。未冒充真人扫码通过。
- 本地开发服务热更新曾遗留旧 watcher，已定向清理并恢复唯一实例；随后浏览器验收通过。此问题未影响服务器上正在运行的 1.0.0。

本期只有用户实际用钉钉扫描并授权，才能确认企业开放平台回调和个人接口权限完整配置。自动化测试不替代真人扫码授权。
