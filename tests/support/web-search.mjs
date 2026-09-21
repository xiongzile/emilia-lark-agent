import {parameters} from "../../dist/tools/web-search.js";

// Real search schema; deterministic public results, without coaching a bad query.
export function mockWebSearch(term, result) {
    return {
        name: "web_search", label: "Web Search",
        description: "Search the public web. Returns source titles, URLs and excerpts; cite the sources used.",
        parameters,
        async execute(_id, {query}) {
            const results = query.toLowerCase().includes(term.toLowerCase()) ? [result] : [
                {title: "General AI news", url: "https://example.org/news", content: "Several unrelated AI products launched recently."},
            ];
            return {content: [{type: "text", text: JSON.stringify({query, results})}]};
        },
    };
}
