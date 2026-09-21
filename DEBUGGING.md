# 本地调试

本项目使用 pnpm，并把 Pi 源码固定在仓库的 `vendor/pi` submodule。Agent
直接依赖其中的 `packages/agent` 和 `packages/ai`。

准备与重新构建：

```sh
cp .env.example .env
# 编辑 .env，填写 FEISHU_APP_ID、FEISHU_APP_SECRET 和 DEEPSEEK_API_KEY
git submodule update --init --recursive
pnpm build:pi
pnpm install
pnpm build
```

在 JetBrains IDE 中创建 Node.js 运行配置，入口设为 `src/index.ts`，Node 参数加入
`--env-file-if-exists=.env --enable-source-maps`。调试时再加入 `--inspect-brk`。
入口直接运行 TypeScript，需要支持 TypeScript stripping 的 Node。
启动后监听飞书消息；收到文本消息时调用 DeepSeek，回复流式输出到终端。
飞书应用凭据和 `DEEPSEEK_API_KEY` 均从环境变量读取；本地开发可放在不会提交的 `.env` 中。

可用 `pnpm start` 启动。

## macOS 后台常驻

使用 `launchd` 守护进程，并让 `caffeinate -i` 只阻止系统因空闲而睡眠。显示器仍可正常熄灭，锁屏和密码策略不受影响：

```sh
pnpm service:install
pnpm service:status
```

服务异常退出后会自动重启。日志位于 `logs/agent.stdout.log` 和
`logs/agent.stderr.log`。停止并移除服务：

```sh
pnpm service:uninstall
```

安装脚本会记录当前 Node 绝对路径和 PATH，因此不依赖 `launchd` 的精简默认环境。
升级或切换 Node 后重新执行一次 `pnpm service:install`。

## 调试仓库内的 Pi 源码

`vendor/pi` 是公开 Pi 仓库的 submodule；`package.json` 的两个 Pi 依赖直接
链接到它。团队成员和 CI 通过 submodule 指针使用同一个提交。首次 clone 后运行
`git submodule update --init --recursive`，修改 Pi 源码后运行 `pnpm build:pi`，
再重启调试进程。

在当前工程的 JetBrains IDE 中使用 `Debug Local Pi` 运行配置点击 **Debug**。
它的入口是本工程的 `src/index.ts`，工作目录是工程根目录，Node 参数包含
`--env-file-if-exists=.env --enable-source-maps`。点击 Debug 时 IDE 会连接 Node
调试器；命令行入口 `pnpm debug:agent` 则会在启动时暂停并等待连接到 9229。
本地 `.env` 必须提供运行所需的飞书和 DeepSeek 凭据。
如果后台 `launchd` 服务仍在运行，调试前执行 `pnpm service:uninstall`，避免两个
进程同时监听同一个飞书应用；调试结束后可用 `pnpm service:install` 恢复。

要在 Pi 中下断点，打开 `vendor/pi/packages/agent/src/agent.ts`，在
`Agent.prompt()` 实现处下断点；DeepSeek 适配器位于
`vendor/pi/packages/ai/src/providers/deepseek.ts`。运行时的 JavaScript source map
会映射回这些源码。若修改了 Pi 源码，执行 `pnpm build:pi` 后重启 IDE 调试进程。

推进 Pi 版本时执行 `git submodule update --remote vendor/pi`，重新安装和构建并
检查兼容性，再提交更新后的 submodule 指针。Pi 的 `main` 更新不会自动进入本工程。

## 目录

- `src/index.ts`：创建 agent 并启动飞书监听。
- `src/channels/feishu.ts`：飞书长连接、消息解析和发送。
- `src/channels/feishu-agent.ts`：消息排队、流式卡片及普通回复兜底。
- `src/agent/deepseek.ts`：创建 DeepSeek agent、注册工具和记录调用。
- `src/agent/turn.ts`：发送单轮 prompt，收集最终回答并转发流式文本。
- `src/config/feishu.ts`：从环境变量读取飞书应用配置。
- `src/config/local.ts`：加载忽略提交的本地工作区、Prompt 和命令工具。

当前 demo 共用一个 agent，会话历史也共用；回复通过飞书流式卡片返回，CardKit
不可用时降级为普通 Markdown 回复。

## Lark CLI Tool

本机安装官方 `lark-cli` 后，`src/tools/lark-cli.ts` 将它注册为 DeepSeek Agent 的
`lark_cli` Tool。应用凭据由 `lark-cli config init` 安全保存，Agent 不负责修改登录、
配置、Profile 或升级状态。

检查安装和 Bot 身份：

```sh
lark-cli --version
lark-cli whoami
lark-cli doctor
```

个人日历、邮箱、个人云盘等用户资源需要单独执行 `lark-cli auth login`，并授权相应的
最小权限。Bot 与用户身份是两套授权，排查时分别执行 `whoami --as bot` 和
`whoami --as user`。
