import { AccessToast } from "@/components/access-toast";
import { ProtectedHeader } from "@/components/layout/protected-header";
import { ProtectedSidebar } from "@/components/layout/protected-sidebar";
import { guardRoute } from "@/lib/rbac";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardRoute();

  return (
    <div className="flex min-h-screen w-full bg-gradient-to-br from-secondary/95 via-secondary/90 to-background">
      <ProtectedSidebar />
      <div className="flex flex-1 flex-col">
        <ProtectedHeader />
        <AccessToast />
        <div className="flex-1 overflow-y-auto bg-background/95">
          <div className="mx-auto w-full max-w-6xl px-6 py-8">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
