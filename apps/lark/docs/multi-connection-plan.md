# Lark 多连接实现与验收

## 当前状态

- App 源码：v0.2.0，目录 `/home/rome/.rome/default/projects/apps/lark`。
- Core 开发分支：`feat/lark-delegation`，隔离工作树 `/home/rome/.rome/default/projects/lark-core`，基于 `55cfac3e`。
- 交付范围：本地开发、安装与测试。不会创建 PR、推送分支或升级当前在线 Core。
- 本地测试实例：`127.0.0.1:4252`，通过 AppManager 安装 App。飞书服务、Bot IM 传输和登录身份为模拟夹具。
- 当前在线实例的 Core 和既有 Bot 不变。在线 App v0.1.2 不是本次本地 v0.2.0 实例。

## 已实现

1. 浏览 Rome 管理的多个飞书连接，按明确的 `connectionId` 选择。不会默认取第一个，也不会失败后换 Bot。
2. Core 提供版本为 1 的内部委托接口。Core 持有密钥、获取租户令牌、刷新用户令牌；App 只得到结果和非秘密授权版本。
3. 从官方 CLI 固定提交构建 `authsidecar` 版本。每次调用创建临时签名代理，绑定 Bot、身份、授权版本和读写类型。业务代码仍由官方 CLI 执行。
4. 21 个审核命令支持独立连接选择。用户专属命令拒绝 Bot 身份；用户授权不能跨应用借用。
5. 查询应用权限快照，展示飞书确认的已授权/未授权状态、查询时间和错误。查询失败不等于缺权限。
6. Core 设置页支持针对该应用的用户授权、撤销及刷新。新增/撤销用户授权只重建 Act，不重连 Bot IM。
7. 对指定文档做有效读取检查，丢弃内容，只返回结果。此检查不代表写权限，也不列出全部 ACL 成员。
8. 生成所需权限申请清单并链接到对应应用的官方控制台。开通、管理员批准、发布及重新授权仍由用户确认。
9. 写入走 Rome 审批。审批绑定连接、应用授权版本、App 配置版本和稳定请求 ID。授权变化使旧审批失效；不确定写入不自动重试。
10. App 不另建 Bot IM 监听器，不读取、导出或复制既有连接密钥。

## 边界

- 内部代理只监听 loopback，属于 Rome 的受信任本机边界，不是对任意第三方代码的安全沙箱。
- Core 再次验证相对 API 路径、方法、身份、读写类别和大小限制，禁止令牌接口、任意域名及自带 Authorization。
- CLI 只拿到临时代理能力和占位凭据，不拿到飞书令牌。临时工作目录在调用结束后删除。
- App 私有页面与工具仍要求 guardian 私聊来源。访客、群聊和未知来源失败关闭。
- 明确选择 `local-cli` 或旧调用省略选择时，保留独立 CLI 配置路径。它不是 Core 连接失败后的回退路径。

## 尚未完成的验收

- 真实飞书账号的权限、OAuth、读取及审批后写入验收。模拟服务通过不能代替真实服务通过。
- 标准 Nix/Docker `pnpm dev:all` 验证：当前容器没有 Nix 和 Docker。
- PR、合并、正式 Core 发布：不属于本次授权范围。

详细测试证据与复现步骤见 [本地验收报告](local-acceptance.md)。

## 上游依据

- 官方 CLI：`larksuite/cli`，提交 `017b19a793ad71794a02887ede04757f3d82e10d`，版本 `1.0.98`，MIT。
- [应用权限接口](https://open.feishu.cn/document/application-v6/scope/list)。
- [官方 CLI 扩展](https://github.com/larksuite/cli/tree/017b19a793ad71794a02887ede04757f3d82e10d/extension)。
- [Core 凭据代理 ADR](https://github.com/rome-os/rome/blob/main/docs/adrs/brokered-provider-capability-over-token-handoff.md)。
