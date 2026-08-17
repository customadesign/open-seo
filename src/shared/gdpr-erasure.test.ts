import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  gdprStorageErasurePayloadSchema,
  signGdprErasureRequest,
} from "./gdpr-erasure";

describe("GDPR erasure request", () => {
  it("signs the timestamp and exact body with HMAC SHA-256", async () => {
    const secret = "test-secret";
    const timestamp = "1770000000000";
    const body = '{"userId":"user_1"}';
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    await expect(signGdprErasureRequest(secret, timestamp, body)).resolves.toBe(
      expected,
    );
  });

  it("requires inventories for every workflow that can outlive database deletion", () => {
    const payload = {
      userId: "user_1",
      email: "person@example.com",
      organizationIds: [],
      projectIds: [],
      samSessionIds: [],
      auditIds: [],
      activeAuditWorkflowIds: [],
      activeRankWorkflowIds: [],
      activeAiVisibilityWorkflowIds: [],
      activeReportWorkflowIds: [],
      r2Keys: [],
      googleAccounts: [],
    };
    const parsed = gdprStorageErasurePayloadSchema.parse(payload);

    expect(parsed.activeAiVisibilityWorkflowIds).toEqual([]);
    expect(parsed.activeReportWorkflowIds).toEqual([]);
    const { activeReportWorkflowIds: _omitted, ...incomplete } = payload;
    expect(gdprStorageErasurePayloadSchema.safeParse(incomplete).success).toBe(
      false,
    );
  });
});
