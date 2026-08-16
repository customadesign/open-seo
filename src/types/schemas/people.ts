import { z } from "zod";
import {
  HOSTED_PASSWORD_MAX_LENGTH,
  HOSTED_PASSWORD_MIN_LENGTH,
} from "@/lib/auth-options";

const accessFields = {
  accountType: z.enum(["employee", "client"]),
  projectScope: z.enum(["all", "selected"]),
  // Keep the bulk grant insert below D1's bound-parameter ceiling. Accounts
  // that need broader access should use the employee "all projects" scope.
  projectIds: z.array(z.string().min(1)).max(25),
};

function validateAccess(
  data: {
    accountType: "employee" | "client";
    projectScope: "all" | "selected";
    projectIds: string[];
  },
  ctx: z.RefinementCtx,
) {
  if (data.accountType === "client" && data.projectScope !== "selected") {
    ctx.addIssue({
      code: "custom",
      path: ["projectScope"],
      message: "Client accounts must use selected-project access.",
    });
  }
  if (data.projectScope === "selected" && data.projectIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["projectIds"],
      message: "Select at least one project.",
    });
  }
}

export const issueAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email().transform((value) => value.trim().toLowerCase()),
    password: z
      .string()
      .min(HOSTED_PASSWORD_MIN_LENGTH)
      .max(HOSTED_PASSWORD_MAX_LENGTH),
    ...accessFields,
  })
  .superRefine(validateAccess);

export const updateMemberAccessSchema = z
  .object({
    memberId: z.string().min(1),
    ...accessFields,
    status: z.enum(["active", "disabled"]),
  })
  .superRefine(validateAccess);

export type IssueAccountInput = z.infer<typeof issueAccountSchema>;
export type UpdateMemberAccessInput = z.infer<typeof updateMemberAccessSchema>;
