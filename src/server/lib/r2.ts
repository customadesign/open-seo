import { env } from "cloudflare:workers";

export async function getJsonFromR2(key: string): Promise<string> {
  const object = await env.R2.get(key);
  if (!object) {
    throw new Error("Audit payload not found");
  }

  return object.text();
}

export async function putTextToR2(
  key: string,
  body: string,
): Promise<{ key: string; sizeBytes: number }> {
  await env.R2.put(key, body, {
    httpMetadata: {
      contentType: "application/json",
    },
  });

  return {
    key,
    sizeBytes: Buffer.byteLength(body),
  };
}

export async function putStreamToR2(
  key: string,
  body: ReadableStream<Uint8Array>,
  contentType = "text/plain",
): Promise<{ key: string }> {
  await env.R2.put(key, body, {
    httpMetadata: { contentType },
  });
  return { key };
}

export async function getStreamFromR2(
  key: string,
): Promise<ReadableStream<Uint8Array>> {
  const object = await env.R2.get(key);
  if (!object?.body) {
    throw new Error("Log file object not found");
  }
  return object.body;
}
