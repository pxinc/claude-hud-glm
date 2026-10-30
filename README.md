# claude-hud-glm

在现有 [Claude HUD](https://github.com/jarrodwatts/claude-hud) 的 Context 后显示 **GLM Coding Plan 的 5 小时／周额度、进度条和重置倒计时**。

```text
[GLM] │ my-project git:(main)
Context ████░░░░░░ 42% │ 5h已用 ███░░░░░░░ 30%·2h15m │ 周已用 ████░░░░░░ 45%·3d4h
```

GLM Coding Plan quota bars and reset countdowns for an existing Claude HUD installation. Runs locally without model calls or a background daemon.

## 功能

- 复用 HUD 自带的条形和配色，保留原模型、项目、Context 和其他状态行。
- 默认每 **5 分钟**自动刷新。消息触发的额外重绘读取缓存，并重新计算倒计时。
- 同账户多窗口共享缓存和请求锁；不同平台／密钥的缓存隔离。
- 超时、断网、限流时保留旧配额并提示数据年龄；失败后退避重试。
- 不修改 claude-hud 插件文件，安装时备份状态栏配置，支持恢复。

## 前提

- macOS 或 Linux、[Bun](https://bun.sh/) 1.3+；Windows 安装尚未验证。
- 已安装 Claude Code 和 claude-hud，并完成 HUD setup。
- HUD 使用 **expanded 布局**，且显示 Context。compact 布局暂不支持。
- 已将个人 GLM Coding Plan 配置到 Claude Code。

本项目实测 claude-hud **0.0.11**。它调用 HUD 的内部渲染模块，后续上游版本可能需要适配；安装前会检查所需接口。升级 HUD 后建议再次运行 `bun setup.mjs check`。

若还没有安装 HUD，在 Claude Code 中运行：

```text
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

## 安装

```sh
git clone https://github.com/pxinc/claude-hud-glm.git
cd claude-hud-glm
bun setup.mjs check
bun setup.mjs install
```

安装器自动寻找本机 Bun 和最新的完整 claude-hud 缓存版本，将三个运行文件复制到 `~/.claude/claude-hud-glm/`，设置 `statusLine.refreshInterval` 为 `300`。支持 `CLAUDE_CONFIG_DIR`。原有其他 Claude 设置保持不变。

不需要安装智谱的指令式查询插件。已有 Claude Code 窗口若没有自动更新，退出后重新启动。

## 凭据与数据

读取 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。优先使用当前进程环境变量，独立运行时回退读取 Claude Code 的 `settings.json` 中的 `env`。**无需在本项目填写或保存 API Key。**

支持的官方服务商：

| 平台 | Claude Code Base URL |
|---|---|
| 智谱国内 | `https://open.bigmodel.cn/api/anthropic` |
| Z.ai 国际 | `https://api.z.ai/api/anthropic` |

国内个人 Coding Plan 已实际联调；国际平台的地址适配已实现，尚无真实账户验证。仅向白名单官方域名发送 HTTPS 查询，禁止跟随重定向。切换到其他服务商时保留原 HUD，隐藏 GLM 扩展。

配额数据来自官方插件也使用的 `/api/monitor/usage/quota/limit` 接口；接口字段和可用性可能变化。更多信息见[智谱官方插件说明](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin)。

进度条和百分比表示**已用**。缺失额度显示 `--`；没有重置时刻则省略倒计时；超过重置时刻显示“待重置”，等待下一次服务端数据。`d`、`h`、`m` 分别表示天、小时、分钟。

2 秒查询超时；429 尊重 `Retry-After`，连续失败会延长重试间隔。每 5 分钟刷新是正常情况下的目标频率，平台统计延迟、Claude Code 的调度和终端重绘均可能影响显示时间。关闭 Claude Code 后不在后台继续查询。

缓存只保存配额、重置时间和请求状态，不保存密钥。安装备份只保存 `statusLine` 字段，不复制带有凭据的完整设置。请勿将个人 Claude 配置、缓存或实际使用记录提交到仓库。

## 更新与卸载

```sh
git pull
bun setup.mjs check
bun setup.mjs install
```

卸载并恢复安装前的状态栏：

```sh
bun setup.mjs uninstall
```

重复安装保留最初的备份。若安装后又手动修改了状态栏，安装器和卸载器会停止自动覆盖，提示检查 `~/.claude/claude-hud-glm/install-state.json`。卸载保留运行文件和备份，以便重新安装；其他当前设置不受影响。

## 开发与测试

无需安装依赖：

```sh
bun run test
```

测试使用临时目录和模拟凭据，不需要真实密钥、Claude Code 或 claude-hud。覆盖缓存边界、失败退避、并发去重、账户隔离、倒计时、窄屏布局、带空格／引号的安装路径、重复安装和卸载恢复。

独立查看 JSON 格式的用量文字：

```sh
bun glm-hud.mjs
```

## License

MIT。上游及参考项目见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目与 Anthropic、智谱及 Z.ai 无官方隶属关系。
