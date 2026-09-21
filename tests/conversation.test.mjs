import assert from "node:assert/strict";
import {test} from "node:test";
import {uncertainTurn, contextTurnIds, advanceConversation} from "../dist/agent/conversation.js";

const route = (mode, history = "current", topic = "") => ({...uncertainTurn(), source: "jev", mode, history, topic});

test("明确的新聊天隔离旧工作，不确定的新聊天仍保留追问对象", () => {
    assert.deepEqual(contextTurnIds(route("chat", "new"), {}, [{messageId: "jev"}]), []);
    const ambiguous = {...route("chat", "new"), reason: "uncertain_mode"};
    assert.deepEqual(contextTurnIds(ambiguous, {}, [{messageId: "jev"}]), ["jev"]);
    assert.equal(advanceConversation({}, ambiguous, "question").segmentStart, undefined);
});

test("问候归档旧话题和任务，明确恢复后才能在当前段延续旧出处", () => {
    let state = advanceConversation({}, route("task", "new", "创建 MR"), "mr-request");
    state = advanceConversation(state, route("chat", "new", "Jev 架构"), "jev");
    state = advanceConversation(state, route("greet", "new"), "hello");
    assert.deepEqual(state.taskContext.messageIds, ["mr-request"]);
    assert.deepEqual(contextTurnIds(route("chat"), state, []), []);
    assert.deepEqual(contextTurnIds(route("task"), state, []), []);
    assert.deepEqual(contextTurnIds(route("task", "recall"), state, []), ["jev", "mr-request"]);
    state = advanceConversation(state, route("task", "recall", "创建 MR"), "resume");
    assert.deepEqual(contextTurnIds(route("task"), state, []), ["mr-request", "resume"]);
    state = advanceConversation(state, route("chat", "new", "猫还是电影"), "choices");
    assert.deepEqual(contextTurnIds(route("chat"), state, []), ["choices"]);
});


test("任一判断不确定时保留当前段的两类出处，仍不越过问候分界", () => {
    const state = {currentTopic: {name: "准备 MR", messageIds: ["task-misclassified-as-chat"]}};
    const partial = {...route("task"), reason: "uncertain_history"};
    assert.deepEqual(contextTurnIds(partial, state, []), ["task-misclassified-as-chat"]);
    assert.deepEqual(contextTurnIds(partial, {...state, segmentStart: "hello"}, []), []);
});

test("聊天中确定的对象也能供后续工具请求使用，不混入上一段的任务", () => {
    const state = {segmentStart: "alias", currentTopic: {name: "pi 是 agent 仓库", messageIds: ["alias", "correction"], segmentStart: "alias"},
        taskContext: {name: "旧文档", messageIds: ["old-task"]}};
    assert.deepEqual(contextTurnIds(route("task", "current"), state, [{messageId: "latest"}]), ["latest", "alias", "correction"]);
});
