import { redirect } from "next/navigation";

import { AcceptInviteCard } from "@/app/(protected)/admin/components/accept-invite-card";
import { guardRoute } from "@/lib/rbac";

export default async function AcceptInvitePage() {
  const { session } = await guardRoute({ requireProfile: false });

  if (!session) {
    redirect("/login?redirect=/admin/accept-invite");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/10 px-6 py-16">
      <div className="w-full max-w-lg space-y-6 rounded-lg border border-border/60 bg-background p-6 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-xl font-semibold text-foreground">
            Accept tenant invite
          </h1>
          <p className="text-sm text-muted-foreground">
            Paste the invite token you received to join the tenant. You must be
            signed in before accepting.
          </p>
        </div>
        <AcceptInviteCard />
      </div>
    </main>
  );
}
