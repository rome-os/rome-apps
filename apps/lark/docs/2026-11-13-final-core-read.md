# 最终 Core 文档读取接口适配（本地候选）

既有候选已经通过 `ctx.connections` 实现 Core Bot 的单份 Docx 纯文本读取：显式 connectionId、App 身份、文档约束，不提供任意 HTTP、用户 OAuth、托管写入或 local-cli 回退。本次不是重新新增读取功能。

## 本次对齐

Core PR #2113 最后评审把提供方原因从 `detail.message` 移到可选的 `detail.reason`，`message` 只保留人类文本。本候选只识别已知的结构化 reason。缺少或未知 reason 时保留 `provider_error`，不解析 message、不透出提供方文本，reason 也不能覆盖 Core 的访问拒绝。

继续使用公开 SDK 0.11.3，通过未知错误边界的结构校验兼容新增字段，不需要复制 Core 私有模块，也没有依赖未发布的 npm 版本。

## 验证边界

- 回归测试覆盖六种原因、缺少/未知原因、跨 SDK 副本错误、访问拒绝优先、不走 CLI 和不记录文档正文。
- 实际 App 源码与实际 Core gateway 组合测试使用内存数据库、独立 SDK 副本及模拟提供方。只注册 actor，不启动 Bot IM listener。
- 单元测试、类型与构建通过不等于已安装试用，更不是实际飞书文档读取。
- 生产实例仍需包含 PR #2113 的 Core，不能只重装 App 补齐服务端能力。

本地准备不授权生产升级、远程部署、App 安装或真实资源读取。试用部署方案在主项目报告中单独确认。
