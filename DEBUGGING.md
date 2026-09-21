# 本地调试

本项目使用 pnpm，并从公开包仓库安装 agent runtime 依赖。

准备与重新构建：

```sh
cp .env.example .env
# 编辑 .env，填写 FEISHU_APP_ID、FEISHU_APP_SECRET 和 DEEPSEEK_API_KEY
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

调试依赖源码时，可在 IDE 中打开 `node_modules` 里 source map 指向的源码；不要只在
`.d.ts` 的方法声明上下断点。

命令行调试入口为 `pnpm debug:agent`，它会在启动时暂停，等待调试器连接到 9229。

## 目录

- `src/index.ts`：启动服务，将飞书文本排队传给 agent。
- `src/channels/feishu.ts`：飞书长连接、文本消息解析。
- `src/agent/deepseek.ts`：创建 DeepSeek agent、输出流式回复。
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
