// Which sign-in routes a deployment offers. Both the server (policy enforcement)
// and the client bundle (which controls to render) need these answers, so the
// predicates take a raw value: the server passes the Workers env, the client
// passes `import.meta.env`. Keeping them here avoids dragging
// `cloudflare:workers` into the browser bundle via auth.ts.
//
// The defaults are asymmetric on purpose. Registration is closed unless a
// deployment opts in, because a self-hosted instance on a public hostname with
// open signup hands accounts to anyone who finds it. Google sign-in is left on
// unless a deployment opts out, because the multi-tenant hosted product needs
// it and must not change behaviour when this ships.

export function isPublicSignupDisabled(value: string | null | undefined) {
  return value !== "false";
}

export function isSocialLoginDisabled(value: string | null | undefined) {
  return value === "true";
}

export function isPublicSignupDisabledOnClient() {
  return isPublicSignupDisabled(import.meta.env.DISABLE_PUBLIC_SIGNUP);
}

export function isSocialLoginDisabledOnClient() {
  return isSocialLoginDisabled(import.meta.env.DISABLE_SOCIAL_LOGIN);
}
