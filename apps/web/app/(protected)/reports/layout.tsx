import type { ReactNode } from "react";

import ProtectedLayout from "../(app)/layout";

export default function ReportsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ProtectedLayout>{children}</ProtectedLayout>;
}
