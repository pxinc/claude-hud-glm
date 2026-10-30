# claude-hud-glm

[English](README.md) | 简体中文

在现有 [Claude HUD](https://github.com/jarrodwatts/claude-hud) 的 Context 后显示 **GLM Coding Plan 的 5 小时／周额度、进度条和重置倒计时**。

状态标签和安装提示目前为中文。

```text
[GLM] │ my-project git:(main)
Context ████░░░░░░ 42% │ 5h已用 ███░░░░░░░ 30%·2h15m │ 周已用 ████░░░░░░ 45%·3d4h
```

## 功能

- 复用 HUD 自带的条形和配色，保留原模型、项目、Context 和其他状态行。
- 默认每 **5 分钟**自动刷新。消息触发的额外重绘会重新计算倒计时，查询到期前使用缓存。
- 使用相同 Claude 配置目录、平台和 API Key 的窗口共享缓存和请求锁；不同凭据或配置目录使用独立缓存。
- 超时、断网、限流时保留旧配额并提示数据年龄；失败后退避重试。
- 不修改 claude-hud 插件文件，安装时备份状态栏配置，支持恢复。

## 前提

- macOS 或 Linux、[Bun](https://bun.sh/) 1.3+；安装器不支持 Windows。
- 已安装 Claude Code 和 claude-hud，并完成 HUD setup。
- Claude Code 版本需支持 `statusLine.refreshInterval`。
- HUD 使用 **expanded 布局**，且显示 Context。compact 布局暂不支持。
- 已将个人 GLM Coding Plan 配置到 Claude Code。

本项目实测 claude-hud **0.0.11** 和 **0.14.0**。它调用 HUD 的内部渲染模块，其他版本可能需要适配；安装前会检查所需接口。升级 HUD 后建议再次运行 `bun setup.mjs check`。

若还没有安装 HUD，在 Claude Code 中运行：

```text
/plugin marketplace add jarrodwatts/claude-hud
/plugin install claude-hud
/reload-plugins
/claude-hud:setup
```

## 插件市场安装

在 Claude Code 中运行：

```text
/plugin marketplace add pxinc/claude-hud-glm
/plugin install claude-hud-glm@claude-hud-glm-marketplace
/reload-plugins
/claude-hud-glm:setup
```

第一步注册本项目的第三方插件市场，第二步打开插件详情，选择安装范围后完成安装。最后一步配置状态栏。Claude Code 的插件设置目前不能直接设置主 `statusLine`，因此插件安装完成后仍需执行一次 setup；该命令会检查依赖并备份原状态栏。

卸载时先运行 `/claude-hud-glm:uninstall`，再通过 `/plugin` 卸载插件，以保留恢复命令入口。

## 从源码安装

```sh
git clone https://github.com/pxinc/claude-hud-glm.git
cd claude-hud-glm
bun setup.mjs check
bun setup.mjs install
```

安装器使用运行 setup 的 Bun，寻找最新的完整 claude-hud 缓存版本，将三个运行文件复制到 `~/.claude/claude-hud-glm/`，设置 `statusLine.refreshInterval` 为 `300`。支持 `CLAUDE_CONFIG_DIR` 和 `CLAUDE_CODE_PLUGIN_CACHE_DIR`，保留其他 Claude 设置。

不需要安装智谱的指令式查询插件。已有 Claude Code 窗口若没有自动更新，退出后重新启动。

## 凭据与数据

读取 `ANTHROPIC_BASE_URL` 和 `ANTHROPIC_AUTH_TOKEN`。优先使用当前进程环境变量，独立运行时回退读取 Claude Code 的 `settings.json` 中的 `env`。**无需在本项目填写或保存 API Key。**

支持的官方服务商：

| 平台 | Claude Code Base URL |
|---|---|
| 智谱国内 | `https://open.bigmodel.cn/api/anthropic` |
| Z.ai 国际 | `https://api.z.ai/api/anthropic` |

国内个人 Coding Plan 已使用真实账户和 Claude HUD 0.0.11 联调；HUD 0.14.0 使用模拟配额数据验证。国际平台的地址适配已实现，尚无真实账户验证。仅向白名单官方域名发送 HTTPS 查询，禁止跟随重定向。切换到其他服务商时保留原 HUD，隐藏 GLM 扩展。

配额数据来自官方插件也使用的 `/api/monitor/usage/quota/limit` 接口；接口字段和可用性可能变化。更多信息见[智谱官方插件说明](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin)。

进度条和百分比表示**已用**。缺失额度显示 `--`；没有重置时刻则省略倒计时；超过重置时刻显示“待重置”，等待下一次服务端数据。`d`、`h`、`m` 分别表示天、小时、分钟。

2 秒查询超时。首次没有缓存时，并发窗口最多等待约 2.2 秒以复用首次查询结果；刷新已有额度时继续显示缓存。若刷新中断，后续重绘可在锁过期 10 秒后恢复查询。429 使用 `Retry-After`，上限为 24 小时，连续失败会延长重试间隔。

各窗口的 Context 和重绘时机相互独立。其他窗口会在下次重绘时显示共享额度，数值不一定同时更新。正常情况下的查询目标间隔为 5 分钟；平台统计延迟、Claude Code 调度和终端重绘均可能影响显示时间。关闭 Claude Code 后不在后台继续查询。

缓存只保存配额、重置时间和请求状态，不保存密钥。安装备份只保存 `statusLine` 字段，不复制完整设置；但该字段中的命令本身可能含有敏感数据。请勿将个人 Claude 配置、缓存或实际使用记录提交到仓库。

## 故障排查

- 若没有显示额度进度条，检查 Claude HUD 是否使用 expanded 布局并显示 Context。更新插件或 HUD 后重新运行 `/claude-hud-glm:setup`。
- 若额度显示 `--` 或警告，检查显示的原因以及 GLM 地址、凭据配置。接口未返回的额度会显示 `--`；请求失败时，有缓存则显示上次数据。
- 若 setup 后仍显示旧状态栏，重启 Claude Code 会话。

## 更新与卸载

插件安装方式：在终端中运行：

```sh
claude plugin marketplace update claude-hud-glm-marketplace
claude plugin update claude-hud-glm@claude-hud-glm-marketplace
```

然后在 Claude Code 中运行 `/reload-plugins` 和 `/claude-hud-glm:setup`，将更新后的运行文件复制到安装目录。

源码安装方式：在克隆目录中运行：

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

测试使用临时目录和模拟凭据，不需要真实密钥、Claude Code 或 claude-hud。覆盖缓存边界、失败退避、多进程并发去重与恢复、凭据隔离、倒计时、窄屏布局、带空格／引号的安装路径、重复安装和卸载恢复。CI 还会测试[固定修订版的 claude-hud 0.14.0](https://github.com/jarrodwatts/claude-hud/tree/a235aa9e05e6b988a70dc54cf78fcbf6e98853c2)。

独立查看 JSON 格式的用量文字：

```sh
bun glm-hud.mjs
```

版本变化见 [CHANGELOG.md](CHANGELOG.md)，开发和问题反馈见 [CONTRIBUTING.md](CONTRIBUTING.md)，漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 协议

[MIT](LICENSE)
