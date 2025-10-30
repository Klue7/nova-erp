import type { ReactNode } from "react";

import ProtectedShellLayout from "../(app)/layout";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <ProtectedShellLayout>{children}</ProtectedShellLayout>;
}
