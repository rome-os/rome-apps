# Lark v0.2.0 本地验收

## 结论与范围

本地实现、安装和模拟服务联调通过。**这不是「真实飞书账号已验收」或「在线 Rome 已升级」。**

- App：`/home/rome/.rome/default/projects/apps/lark`，v0.2.0，8 个工具、21 个审核命令。
- Core：`/home/rome/.rome/default/projects/lark-core`，分支 `feat/lark-delegation`，代码提交 `abdcd253`，基于 `55cfac3e`。
- 本地实例：`http://127.0.0.1:4252/full/apps/lark`。可在 Rome 的 [浏览器](/desktop) 查看。
- 安装使用真实 AppManager，API 使用真实 AppApiDispatcher，写入使用真实 ActionEngine 与审批流程，业务使用真实官方 CLI。
- 飞书 HTTP 服务、Bot IM 传输及 guardian 登录身份使用明确的模拟夹具。没有使用任何真实飞书密钥或用户令牌。
- 当前在线 Core、App v0.1.2 和既有 Bot 接入不变。没有创建 PR、推送分支或发布上线。

## 已通过的检查

| 检查 | 结果 |
|---|---|
| App 类型检查 | 通过 |
| App 自动测试 | 36 项通过 |
| Core 相关测试 | 6 个文件、57 项通过 |
| 本地安装后的端到端检查 | 10 项通过 |
| 官方 CLI 干净重建 | 与现有二进制 SHA-256 相同 |
| 真实飞书账号 | 未验收 |

Core 相关测试覆盖实际 Feishu 描述符、代理传输、CLI 路径契约、可选授权生命周期，以及用户授权在注册表重载后的刷新和持久化。撤销用户授权不会停掉 Bot IM。

10 项本地端到端检查包括：

1. 两个应用各自的权限快照，明确区分已授予与未授予。
2. 两个真实官方 CLI 进程并行读取，各自走所选 Bot。
3. 指定文档有效读取检查，结果不返回文档内容。
4. 写入停在审批门，审批前没有提供方写入。
5. 单应用用户设备授权，不重启 Bot IM。
6. 授权版本变化后，旧审批不能产生写入。
7. 用户专属命令使用所属应用的授权，另一 Bot 不可借用。
8. 批准写入成功，同一稳定请求 ID 不重复提供方写入。
9. 较低权限 Bot 被拒绝后不改用较高权限 Bot。
10. 撤销 Bot 使待处理审批和后续调用失效，另一 Bot 的 IM 与读取不受影响。

## 浏览器检查

已检查连接与权限面板、文档检查结果、375px 移动布局和全局语言跟随。页面没有独立语言开关。页面不并列展示中英两套文案。技术标识、权限名称和模拟 Bot 名称不翻译。

- [权限面板](../.verification/final-permissions-desktop.png)
- [移动布局](../.verification/final-permissions-mobile.png)
- [文档检查](../.verification/final-access-probe.png)

## 不通过或尚未执行的项目

- 全量 Core 单元测试中，未改动的 `src/channels/wechat-user-session.test.ts` 的一项会话测试超时。使用隔离 HOME 单独复跑同样为 4 通过、1 超时。没有为得到全绿而改动该测试。
- 标准 Nix/Docker `pnpm dev:all` 未执行：此环境没有 Nix、Docker 和 C++ 编译工具。Node 为 24.22.1，符合仓库使用的主版本，但这不能代替 devShell 验证。
- 本地依赖使用冻结锁文件安装。node-pty 1.1.0 使用同机可信运行镜像中相同版本的原生模块，仅复制到开发工作树依赖目录。没有修改运行镜像。
- `pnpm lint:prose` 因环境没有 Vale 而未通过。修改的 Core TypeScript 文件通过 Biome 检查。
- 真实飞书租户权限、OAuth 行为、真实资料读取及审批后真实写入尚未验收。不能用模拟权限结果推断既有 Bot 的真实权限。

## 官方 CLI 构建证据

- 上游版本：1.0.98。
- 上游提交：`017b19a793ad71794a02887ede04757f3d82e10d`。
- 构建标签：`authsidecar`，没有修改上游业务源码。
- Go：1.27.3，官方归档按固定 SHA-256 校验。
- 平台：Linux x64。
- 参数包含 `-mod=readonly -trimpath -buildvcs=false`。
- 二进制 SHA-256：`4b1e0504d758ebf44ff4a3c9076027cdd6c8cd1c195ecd4aa9d91eaa8a426310`。
- 从无二进制、无源码和无 Go 的独立目录执行构建脚本，重建结果与本地验收使用的二进制一致。

构建步骤、许可及来源记录在 `scripts/prepare-sidecar.mjs`、`vendor/sidecar-build.json` 与 `vendor/LICENSE.larksuite-cli`。生成物不提交到 git，安装包包含执行所需的二进制。

## 复现

在配套 Core 工作树安装并构建依赖后，运行下面的模拟验收实例。它只能绑定 loopback，不能接入真实凭据，也不能用于正式服务。

```sh
cd /home/rome/.rome/default/projects/lark-core
mkdir -p .verification/local-home

env -i PATH="$PATH" HOME="$PWD/.verification/local-home" \
  INTERNAL_API_PORT=4252 NODE_ENV=test TZ=Asia/Shanghai CI=true \
  npm_config_store_dir=/home/rome/.local/share/pnpm/store/v11 \
  pnpm exec tsx packages/core/scripts/lark-local-acceptance.ts
```

等到出现 `LARK_LOCAL_ACCEPTANCE_READY` 后，在第二个终端运行：

```sh
node packages/core/scripts/lark-local-check.mjs
```

每次完整复跑先重启模拟实例。检查脚本会撤销第二个模拟 Bot。该实例数据库是测试夹具，不是在线个人资料库。

本地证据位于 Core 工作树的 `.verification/`：`final-targeted.log`、`local-acceptance-check-final.log`、`local-rome/acceptance.json`、`unrelated-wechat-recheck.log`。安装状态以同目录下 `local-rome/apps.lock.json` 为准，不能把它当成在线实例的安装状态。
