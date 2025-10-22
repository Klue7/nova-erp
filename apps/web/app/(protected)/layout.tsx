import type { ReactNode } from "react";

import { guardRoute } from "@/lib/rbac";

export default async function ProtectedRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await guardRoute({ requireProfile: false });

  return <>{children}</>;
}
