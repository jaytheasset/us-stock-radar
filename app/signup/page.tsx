import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="signup" next={next} />;
}
