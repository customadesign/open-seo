import { describe, expect, it } from "vitest";
import { aggregateLogStream } from "./aggregate";

function streamOf(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe("aggregateLogStream", () => {
  it("skips malformed lines and still finishes the upload", async () => {
    const result = await aggregateLogStream(
      streamOf(
        [
          '66.249.66.1 - - [10/Oct/2024:13:55:36 +0000] "GET / HTTP/1.1" 200 100 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"',
          "this is not a log line",
          '66.249.66.1 - - [10/Oct/2024:14:55:36 +0000] "GET /about HTTP/1.1" 404 20 "-" "Mozilla/5.0 (compatible; Googlebot/2.1)"',
        ].join("\n"),
      ),
    );

    expect(result.linesParsed).toBe(2);
    expect(result.linesSkipped).toBe(1);
    expect(result.format).toBe("combined");
    expect(result.pathDaily).toHaveLength(2);
    expect(result.bots[0]).toMatchObject({
      botId: "googlebot",
      verifiedRequests: 2,
    });
  });
});
