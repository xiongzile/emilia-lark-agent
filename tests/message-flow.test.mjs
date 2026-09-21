import assert from "node:assert/strict";
import {test} from "node:test";
import {createFeishuMessageHandler} from "../dist/channels/feishu-agent.js";

const message = (id) => ({messageId: id, chatId: "private-chat", text: `question ${id}`});

test("a failed card setup falls back once and the next message still receives a reply", async (t) => {
    const warning = t.mock.method(console, "warn", () => {});
    const replies = [];
    const turns = [];
    let active = 0;
    const session = {
        async run(id, text, write) {
            active += 1;
            assert.equal(active, 1, "turns must be serialized");
            turns.push(id);
            await Promise.resolve();
            const answer = `answer ${text}`;
            if (write) await write(answer);
            active -= 1;
            return answer;
        },
    };
    const transport = {
        reply: async (id, text) => { replies.push({id, text}); },
        processing: () => async () => {},
        stream: async (_chatId, id, producer) => {
            if (id === "m1") throw new Error("card setup failed");
            await producer(async (text) => { replies.push({id, text}); });
        },
    };
    const handle = createFeishuMessageHandler(session, transport);
    await Promise.all([handle(message("m1")), handle(message("m2"))]);
    assert.deepEqual(turns, ["m1", "m2"]);
    assert.deepEqual(replies.map(({id}) => id), ["m1", "m2"]);
    assert.equal(warning.mock.callCount(), 1);
});

test("a generation failure after the card starts does not block the next message", async (t) => {
    const loggedError = t.mock.method(console, "error", () => {});
    const replies = [];
    let calls = 0;
    const session = {
        async run(id, _text, write) {
            calls += 1;
            if (id === "m1") throw new Error("model interrupted");
            await write("second answer");
            return "second answer";
        },
    };
    const transport = {
        reply: async (id, text) => { replies.push({id, text}); },
        processing: () => async () => {},
        stream: async (_chatId, _id, producer) => producer(async (text) => { replies.push({id: _id, text}); }),
    };
    const handle = createFeishuMessageHandler(session, transport);
    await handle(message("m1"));
    await handle(message("m2"));
    assert.equal(calls, 2);
    assert.deepEqual(replies, [{id: "m2", text: "second answer"}]);
    assert.equal(loggedError.mock.callCount(), 1);
});
