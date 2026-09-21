import assert from "node:assert/strict";
import {test} from "node:test";
import {advanceContext, needsContext} from "../dist/channels/context-state.js";

test("context reloads at startup, after 20 replies, and after a command or failure", () => {
    let state = {kind: "reload"};
    assert.equal(needsContext(state), true);

    for (let turn = 1; turn <= 20; turn += 1) {
        state = advanceContext(state, "replied");
        assert.equal(state.turns, turn);
    }
    assert.equal(needsContext(state), true);
    state = advanceContext(state, "replied");
    assert.deepEqual(state, {kind: "active", turns: 1});

    state = advanceContext(state, "command");
    assert.equal(needsContext(state), true);
    state = advanceContext(state, "replied");
    state = advanceContext(state, "failed");
    assert.equal(needsContext(state), true);
});
