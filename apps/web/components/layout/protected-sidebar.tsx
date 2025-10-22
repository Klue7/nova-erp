"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MODULE_LINKS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function ProtectedSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-64 shrink-0 border-r border-border/70 bg-background/95 p-6 md:flex md:flex-col">
      <div className="mb-8 text-left">
        <Link
          href="/dashboard"
          className="text-xl font-semibold tracking-tight text-foreground"
        >
          Nova Bricks ERP
        </Link>
        <p className="mt-1 text-sm text-muted-foreground">
          Mining to sales control tower
        </p>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {MODULE_LINKS.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <link.icon className="h-4 w-4" aria-hidden />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
        Secure tenant: <strong className="text-foreground">Acme Bricks</strong>
      </div>
    </aside>
  );
}
