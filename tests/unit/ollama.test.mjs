import { describe, expect, it } from "vitest";
import * as ollama from "../../scripts/ai/ollama.mjs";
import { fakeFetch, hang } from "../helpers/fake-ollama.mjs";

const chatBody = (content) => ({ message: { content } });

describe("baseUrl / pickDefaultModel", () => {
  it("normalizes the address", () => {
    expect(ollama.baseUrl("http://localhost:11434///")).toBe("http://localhost:11434");
    expect(ollama.baseUrl("")).toBe(ollama.DEFAULT_URL);
    expect(ollama.baseUrl(undefined)).toBe(ollama.DEFAULT_URL);
  });
  it("picks the first preferred model, never an excluded one", () => {
    expect(ollama.pickDefaultModel(["qwen:latest", "llama3.1:8b", "llama2:latest"])).toBe("llama3.1:8b");
    expect(ollama.pickDefaultModel(["llama3.1:8b", "qwen2.5:3b"])).toBe("qwen2.5:3b");
    expect(ollama.pickDefaultModel(["qwen2.5:3b-instruct", "llama3.1:8b"])).toBe("qwen2.5:3b-instruct");
  });
  it("returns null when no preferred model is installed", () => {
    expect(ollama.pickDefaultModel(["qwen:latest", "llava:latest", "llama3.2-vision:latest"])).toBeNull();
    expect(ollama.pickDefaultModel([])).toBeNull();
    expect(ollama.pickDefaultModel(undefined)).toBeNull();
  });
});

describe("ping / listModels / warmUp", () => {
  it("ping is true when Ollama answers", async () => {
    expect(await ollama.ping("http://x", { fetch: fakeFetch() })).toBe(true);
  });
  it("ping is false when unreachable, without throwing", async () => {
    expect(await ollama.ping("http://x", { fetch: fakeFetch({ down: true }) })).toBe(false);
  });
  it("ping is false after the probe timeout", async () => {
    expect(await ollama.ping("http://x", { fetch: hang, timeoutMs: 20 })).toBe(false);
  });
  it("listModels returns installed names, [] on failure", async () => {
    expect(await ollama.listModels("http://x", { fetch: fakeFetch({ models: ["a", "b"] }) })).toEqual(["a", "b"]);
    expect(await ollama.listModels("http://x", { fetch: fakeFetch({ down: true }) })).toEqual([]);
    expect(await ollama.listModels("http://x", { fetch: hang, timeoutMs: 20 })).toEqual([]);
  });
  it("warmUp posts to /api/generate without prompt and never pulls", async () => {
    const fetch = fakeFetch();
    expect(await ollama.warmUp("http://x", "llama3.1:8b", { fetch })).toBe(true);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe("http://x/api/generate");
    expect(fetch.calls[0].body).toEqual({ model: "llama3.1:8b", keep_alive: ollama.KEEP_ALIVE });
    expect(fetch.calls.some((c) => c.url.includes("/api/pull"))).toBe(false);
  });
  it("warmUp without model does nothing", async () => {
    const fetch = fakeFetch();
    expect(await ollama.warmUp("http://x", "", { fetch })).toBe(false);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("chat (C10)", () => {
  it("ok: parses message.content as JSON", async () => {
    const fetch = fakeFetch({ chat: chatBody('{"results":[]}') });
    const r = await ollama.chat("http://x", { model: "m", messages: [] }, { fetch });
    expect(r).toMatchObject({ ok: true, status: "ok", json: { results: [] } });
    expect(fetch.calls[0].body).toMatchObject({ model: "m", stream: false, keep_alive: ollama.KEEP_ALIVE });
  });
  it("unreachable when the connection fails", async () => {
    const r = await ollama.chat("http://x", {}, { fetch: fakeFetch({ down: true }) });
    expect(r).toMatchObject({ ok: false, status: "unreachable" });
  });
  it("timeout when the answer is slower than the delay", async () => {
    const t0 = Date.now();
    const r = await ollama.chat("http://x", {}, { fetch: fakeFetch({ slow: true }), timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, status: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("aborted when the caller's signal fires", async () => {
    const controller = new AbortController();
    const promise = ollama.chat("http://x", {}, { fetch: fakeFetch({ slow: true }), signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    expect(await promise).toMatchObject({ ok: false, status: "aborted" });
  });
  it("aborted at once when the signal is already aborted", async () => {
    const fetch = fakeFetch();
    const r = await ollama.chat("http://x", {}, { fetch, signal: AbortSignal.abort() });
    expect(r.status).toBe("aborted");
    expect(fetch.calls).toHaveLength(0);
  });
  it("invalid when the content is not JSON", async () => {
    const r = await ollama.chat("http://x", {}, { fetch: fakeFetch({ chat: chatBody('{ "results": [ { "index": 0, "facts": [') }) });
    expect(r).toMatchObject({ ok: false, status: "invalid" });
    expect(r.content).toContain("results");
  });
  it("invalid when the envelope has no content", async () => {
    const r = await ollama.chat("http://x", {}, { fetch: fakeFetch({ chat: { message: {} } }) });
    expect(r).toMatchObject({ ok: false, status: "invalid" });
  });
  it("http when Ollama answers with an error status", async () => {
    const r = await ollama.chat("http://x", {}, { fetch: fakeFetch({ chat: {}, chatStatus: 403 }) });
    expect(r).toMatchObject({ ok: false, status: "http", httpStatus: 403 });
  });
});
