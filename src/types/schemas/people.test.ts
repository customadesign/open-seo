import { describe, expect, it } from "vitest";
import { issueAccountSchema, updateMemberAccessSchema } from "./people";

const validIssue = {
  name: "Casey Client",
  email: "CASEY@EXAMPLE.COM",
  password: "correct horse battery staple",
  accountType: "client" as const,
  projectScope: "selected" as const,
  projectIds: ["project-1"],
};

describe("people access schemas", () => {
  it("normalizes issued-account email addresses", () => {
    const parsed = issueAccountSchema.parse(validIssue);

    expect(parsed.email).toBe("casey@example.com");
  });

  it("requires clients to use selected-project access", () => {
    expect(
      issueAccountSchema.safeParse({
        ...validIssue,
        projectScope: "all",
      }).success,
    ).toBe(false);
  });

  it("requires at least one project for selected access", () => {
    expect(
      issueAccountSchema.safeParse({
        ...validIssue,
        projectIds: [],
      }).success,
    ).toBe(false);
  });

  it("accepts deactivating an employee with all-project access", () => {
    expect(
      updateMemberAccessSchema.safeParse({
        memberId: "member-1",
        accountType: "employee",
        projectScope: "all",
        projectIds: [],
        status: "disabled",
      }).success,
    ).toBe(true);
  });
});
