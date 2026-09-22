import {createDeepSeekAgent} from "./agent/deepseek.ts";
import {AgentSession} from "./agent/session.ts";
import {createFeishuMessageHandler} from "./channels/feishu-agent.ts";
import {replyFeishu, showFeishuProcessing, startFeishu, streamFeishuReply} from "./channels/feishu.ts";
import {MemoryStore} from "./memory/store.ts";

async function main(): Promise<void> {
    const memory = await MemoryStore.open();
    const {agent, distiller, router, compact} = createDeepSeekAgent(memory);
    if (memory.status().pending > 0) distiller.schedule(true);
    const session = new AgentSession(agent, memory, distiller, router, compact);
    await startFeishu(createFeishuMessageHandler(session, {
        reply: replyFeishu,
        processing: showFeishuProcessing,
        stream: streamFeishuReply,
    }));
}

main().catch((error) => {
    console.error("Feishu startup error:", error);
    process.exitCode = 1;
});
