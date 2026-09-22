import {Type} from "@earendil-works/pi-ai";
import {conversation} from "../../support/agent-fixture.mjs";

// configured-cli.ts + workspace-files.ts: the answer is beyond the first page.
conversation({
    name: "查询结果超过预览范围，读取本地完整结果找到末尾编号，不重复远端查询",
    tools: ["files", {
        name: "report_cli", label: "Report CLI",
        description: "Fetch audit report once using args [fetch]. The response includes a receiptId after diagnostic text.",
        parameters: Type.Object({args: Type.Array(Type.String())}),
        async execute(id, params, signal) {
            // Resolve only after the fixture has selected its isolated workspace.
            const {createConfiguredCliTools} = await import("../../../dist/tools/configured-cli.js");
            const [tool] = createConfiguredCliTools([{name: "report_cli", description: "Fetch report", executable: process.execPath,
                prependArgs: ["report.mjs"]}]);
            return tool.execute(id, params, signal);
        },
    }],
    files: [{path: "report.mjs", content: `if (process.argv[2] !== 'fetch') throw Error('only fetch supported'); console.log(JSON.stringify({diagnostics: 'old trace detail; '.repeat(900), receiptId: 'RECEIPT-731-VALID'}));`}],
    events: [
        {user: "请查询报告并告诉我 receiptId。这个查询只能调用一次；如果输出不完整，读取保存的本地结果。", expect: {
            calls: [{tool: "report_cli", args: ["fetch"], count: 1}, {tool: "report_cli", count: 1}, {tool: "workspace_files", operation: "read"}],
            reply: /RECEIPT-731-VALID/,
        }},
    ],
});
