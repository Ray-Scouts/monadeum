import { ApiError } from "@/data/api/client";

/** A read failure in plain language. Nothing is shown in place of the missing data. */
export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.reason === "network-error") return "The API could not be reached. The data below may be out of date.";
    if (error.status === 401) return "Your session has ended. Sign out and sign in again.";
    if (error.status === 404) return "Not found among your agents.";
    if (error.reason === "ownership-mismatch") return "The API's records disagree about who owns this agent, so it refused the request rather than guess.";
    if (error.status === 503) return "This server cannot do that yet: it has no chain, bundler, or session key vault configured.";
    return `The API refused the request (${error.reason}${error.detail ? `: ${error.detail}` : ""}).`;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-bad bg-bad-wash px-4 py-3 text-sm text-bad">
      {errorText(error)}
    </p>
  );
}
