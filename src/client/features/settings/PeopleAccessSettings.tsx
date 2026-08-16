import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/client/components/Modal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { getProjects } from "@/serverFunctions/projects";
import {
  getPeople,
  issueAccount,
  updateMemberAccess,
} from "@/serverFunctions/people";

type ManagedPerson = Awaited<ReturnType<typeof getPeople>>[number];
type AccountType = "employee" | "client";
type ProjectScope = "all" | "selected";

export function PeopleAccessSettings() {
  const [editing, setEditing] = React.useState<ManagedPerson | "new" | null>(
    null,
  );
  const peopleQuery = useQuery({
    queryKey: ["people"],
    queryFn: () => getPeople(),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-base-content/50">
            People &amp; access
          </h2>
          <p className="mt-1 text-sm text-base-content/60">
            Issue employee or client logins and choose which projects they can
            see.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm shrink-0"
          onClick={() => setEditing("new")}
        >
          <Plus className="size-4" />
          Issue account
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-base-300">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Person</th>
              <th>Access</th>
              <th>Status</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {peopleQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="py-8 text-center">
                  <span className="loading loading-spinner loading-sm" />
                </td>
              </tr>
            ) : null}
            {(peopleQuery.data ?? []).map((person) => (
              <tr key={person.memberId}>
                <td>
                  <div className="flex items-center gap-2.5">
                    <span className="rounded-full bg-base-200 p-2">
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {person.name}
                      </span>
                      <span className="block truncate text-xs text-base-content/55">
                        {person.email}
                      </span>
                    </span>
                  </div>
                </td>
                <td>
                  <span className="capitalize">{person.role}</span>
                  {person.role !== "owner" ? (
                    <span className="block text-xs text-base-content/55">
                      {person.projectScope === "all"
                        ? "All projects"
                        : `${person.projectIds.length} project${person.projectIds.length === 1 ? "" : "s"}`}
                    </span>
                  ) : null}
                </td>
                <td>
                  <span
                    className={`badge badge-sm ${
                      person.status === "active"
                        ? "badge-success badge-soft"
                        : "badge-ghost"
                    }`}
                  >
                    {person.status === "active" ? "Active" : "Deactivated"}
                  </span>
                </td>
                <td>
                  {person.role !== "owner" ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-square"
                      aria-label={`Edit ${person.name}`}
                      onClick={() => setEditing(person)}
                    >
                      <Pencil className="size-4" />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <AccessModal person={editing} onClose={() => setEditing(null)} />
      ) : null}
    </section>
  );
}

function AccessModal({
  person,
  onClose,
}: {
  person: ManagedPerson | "new";
  onClose: () => void;
}) {
  const creating = person === "new";
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  });
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [accountType, setAccountType] = React.useState<AccountType>(
    creating ? "employee" : person.role === "client" ? "client" : "employee",
  );
  const [projectScope, setProjectScope] = React.useState<ProjectScope>(
    creating ? "all" : person.projectScope,
  );
  const [projectIds, setProjectIds] = React.useState<string[]>(
    creating ? [] : person.projectIds,
  );
  const [status, setStatus] = React.useState<"active" | "disabled">(
    creating ? "active" : person.status,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalizedScope =
        accountType === "client" ? ("selected" as const) : projectScope;
      if (creating) {
        return issueAccount({
          data: {
            name: name.trim(),
            email: email.trim(),
            password,
            accountType,
            projectScope: normalizedScope,
            projectIds,
          },
        });
      }
      return updateMemberAccess({
        data: {
          memberId: person.memberId,
          accountType,
          projectScope: normalizedScope,
          projectIds,
          status,
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["people"] });
      toast.success(creating ? "Account issued" : "Access updated");
      onClose();
    },
    onError: (error) =>
      toast.error(
        getStandardErrorMessage(
          error,
          creating ? "Failed to issue account" : "Failed to update access",
        ),
      ),
  });

  const effectiveScope = accountType === "client" ? "selected" : projectScope;
  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (creating && password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (effectiveScope === "selected" && projectIds.length === 0) {
      toast.error("Select at least one project");
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Modal
      maxWidth="max-w-lg"
      onClose={saveMutation.isPending ? undefined : onClose}
      labelledBy="people-access-title"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <h2 id="people-access-title" className="text-lg font-semibold">
            {creating ? "Issue account" : `Edit ${person.name}`}
          </h2>
          <p className="mt-1 text-sm text-base-content/60">
            {creating
              ? "The login is ready immediately; share the credentials securely."
              : person.email}
          </p>
        </div>

        {creating ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                className="input input-bordered w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                autoFocus
              />
            </Field>
            <Field label="Email">
              <input
                className="input input-bordered w-full"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Field label="Password">
              <input
                className="input input-bordered w-full"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
            <Field label="Confirm password">
              <input
                className="input input-bordered w-full"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                maxLength={128}
                required
              />
            </Field>
          </div>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Account type</legend>
          <div className="flex gap-4">
            {(["employee", "client"] as const).map((value) => (
              <label key={value} className="flex cursor-pointer gap-2 text-sm">
                <input
                  type="radio"
                  className="radio radio-primary radio-sm"
                  checked={accountType === value}
                  onChange={() => {
                    setAccountType(value);
                    if (value === "client") setProjectScope("selected");
                  }}
                />
                <span className="capitalize">{value}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-base-content/55">
            Employees can use OpenSEO tools. Clients receive read-only report
            access.
          </p>
        </fieldset>

        {accountType === "employee" ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Project access</legend>
            <div className="flex gap-4">
              {(["all", "selected"] as const).map((value) => (
                <label
                  key={value}
                  className="flex cursor-pointer gap-2 text-sm"
                >
                  <input
                    type="radio"
                    className="radio radio-primary radio-sm"
                    checked={projectScope === value}
                    onChange={() => setProjectScope(value)}
                  />
                  {value === "all" ? "All projects" : "Selected projects"}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {effectiveScope === "selected" ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Projects</legend>
            <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-base-300 p-2">
              {(projectsQuery.data ?? []).map((project) => (
                <label
                  key={project.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-base-200"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm"
                    checked={projectIds.includes(project.id)}
                    onChange={(event) =>
                      setProjectIds((current) =>
                        event.target.checked
                          ? [...current, project.id]
                          : current.filter((id) => id !== project.id),
                      )
                    }
                  />
                  <span className="truncate">{project.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {!creating ? (
          <label className="flex items-center justify-between gap-4 rounded-lg border border-base-300 p-3">
            <span>
              <span className="block text-sm font-medium">Active account</span>
              <span className="block text-xs text-base-content/55">
                Deactivation signs the person out and revokes their API keys.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={status === "active"}
              onChange={(event) =>
                setStatus(event.target.checked ? "active" : "disabled")
              }
            />
          </label>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending
              ? "Saving…"
              : creating
                ? "Issue account"
                : "Save access"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
