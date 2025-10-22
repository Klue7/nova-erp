import type { ReactNode } from "react";

import ProtectedShellLayout from "../(app)/layout";

export default function StockpileLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ProtectedShellLayout>{children}</ProtectedShellLayout>;
}
