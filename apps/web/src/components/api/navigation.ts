import type { AuthState } from "./auth";

// Where `api` mode sends a visitor, decided from the session state alone. This is UX gating, not access control: the
// API refuses every unauthenticated read itself (401) and decides authorization on its own records.

export const LOGIN_PATH = "/login";
/** Where a signed-in user lands when no valid `next` was given. */
export const HOME_PATH = "/population";

const BASE = "https://monadeum.invalid";

/**
 * The `next` target after sign-in, accepted only as a same-origin relative path, so the parameter cannot be used as
 * an open redirect. Anything else (an absolute or protocol-relative URL, a backslash, a control character, a path
 * that normalizes to `//host`, or the sign-in page itself) falls back to `HOME_PATH`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return HOME_PATH;
  // Browsers strip tabs and newlines from URLs and read a backslash as a slash, so "/\t/host" and "/\\host" are refused.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== BASE) return HOME_PATH;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || url.pathname === LOGIN_PATH) return HOME_PATH;
  return path;
}

/**
 * The sign-in page, remembering where the visitor was going when that is a valid `next`. `HOME_PATH` is a valid
 * `next` like any other screen: `safeNext` also returns it for a refused target, so its return value alone cannot tell
 * "the visitor was on the population" from "the target was refused", and only the refused case drops `next`.
 */
export function loginHref(pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  const next = safeNext(target);
  if (next === HOME_PATH && target !== HOME_PATH) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(next)}`;
}

export type Decision = { kind: "pending" } | { kind: "render" } | { kind: "redirect"; to: string };

/** An app screen: rendered only for a confirmed session; a signed-out visitor goes to the sign-in page. */
export function gateDecision(state: AuthState, pathname: string, search: string): Decision {
  if (state.status === "loading") return { kind: "pending" };
  if (state.status === "signed-in") return { kind: "render" };
  // Signing out on purpose returns to a plain sign-in page, not one that sends the next user back to this screen.
  return { kind: "redirect", to: state.byUser ? LOGIN_PATH : loginHref(pathname, search) };
}

/** `/login`: shown at once, including while the session is still being checked; a confirmed session moves on. */
export function loginDecision(state: AuthState, search: string): Decision {
  if (state.status !== "signed-in") return { kind: "render" };
  return { kind: "redirect", to: safeNext(new URLSearchParams(search).get("next")) };
}
