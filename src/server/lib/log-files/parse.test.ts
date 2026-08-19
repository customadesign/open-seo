import { describe, expect, it } from "vitest";
import {
  detectLogFormat,
  normalizeResponseTimeMs,
  parseLogLine,
  parseW3cFieldsLine,
  readLogLines,
} from "./parse";

const combined =
  '66.249.66.1 - - [10/Oct/2024:13:55:36 +0000] "GET /blog/post HTTP/1.1" 200 2326 "-" "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" 0.120';

const common =
  '66.249.66.1 - - [10/Oct/2024:13:55:36 +0000] "GET /index.html HTTP/1.0" 200 2326';

const w3c = [
  "#Version: 1.0",
  "#Fields: date time c-ip cs-method cs-uri-stem sc-status sc-bytes time-taken cs(User-Agent)",
  "2024-10-10 13:55:36 66.249.66.1 GET /about 200 512 0.050 Mozilla/5.0+(compatible;+bingbot/2.0)",
].join("\n");

describe("detectLogFormat", () => {
  it("detects Combined, Common, and W3C from sample lines", () => {
    expect(detectLogFormat([combined])).toBe("combined");
    expect(detectLogFormat([common])).toBe("common");
    expect(detectLogFormat(w3c.split("\n"))).toBe("w3c");
  });
});

describe("parseLogLine", () => {
  it("parses a Combined line including optional response time", () => {
    const parsed = parseLogLine(combined, "combined", null);
    expect(parsed).toMatchObject({
      ip: "66.249.66.1",
      day: "2024-10-10",
      path: "/blog/post",
      status: 200,
      bytes: 2326,
      responseTimeMs: 120,
    });
    expect(parsed?.userAgent).toContain("Googlebot");
  });

  it("skips a malformed Combined line", () => {
    expect(parseLogLine("not a log line", "combined", null)).toBeNull();
  });

  it("parses a W3C line after reading #Fields", () => {
    const fields = parseW3cFieldsLine(
      "#Fields: date time c-ip cs-method cs-uri-stem sc-status sc-bytes time-taken cs(User-Agent)",
    );
    const parsed = parseLogLine(
      "2024-10-10 13:55:36 66.249.66.1 GET /about 200 512 0.050 Mozilla/5.0+(compatible;+bingbot/2.0)",
      "w3c",
      fields,
    );
    expect(parsed).toMatchObject({
      path: "/about",
      status: 200,
      responseTimeMs: 50,
      userAgent: "Mozilla/5.0 (compatible; bingbot/2.0)",
    });
  });
});

describe("normalizeResponseTimeMs", () => {
  it("treats values up to 300 as seconds", () => {
    expect(normalizeResponseTimeMs("0.25")).toBe(250);
  });
});

describe("readLogLines", () => {
  it("streams lines without requiring a trailing newline", async () => {
    const lines: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one\ntwo"));
        controller.close();
      },
    });
    await readLogLines(stream, (line) => {
      lines.push(line);
    });
    expect(lines).toEqual(["one", "two"]);
  });
});
