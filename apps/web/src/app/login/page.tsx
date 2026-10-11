import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/api/SignIn";
import { USES_API } from "@/data/config";

// Sign-in exists only in `api` mode; the sample build has no session, so its app screens are reached directly.
export default function LoginPage() {
  if (!USES_API) redirect("/population");
  return <LoginScreen />;
}

export const metadata = { title: "Sign in" };
