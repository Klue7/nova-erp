"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { MODULE_LINKS } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function ProtectedSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden h-full w-64 shrink-0 border-r border-border/70 bg-gradient-to-b from-secondary/95 via-secondary/90 to-background/95 p-6 text-card-foreground shadow-lg shadow-secondary/10 md:flex md:flex-col">
      <div className="mb-10 text-left">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/40">
            <span className="h-3 w-3 rounded-[2px] bg-primary shadow-inner shadow-primary/30" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-card-foreground">
              Nova Bricks ERP
            </p>
            <p className="text-xs uppercase tracking-wide text-primary">
              Mining to sales
            </p>
          </div>
        </Link>
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
                  ? "bg-primary/15 text-primary shadow-inner shadow-primary/20"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
              )}
            >
              <link.icon
                className={cn(
                  "h-4 w-4 transition",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-lg border border-border/60 bg-background/80 p-4 text-sm text-muted-foreground shadow-inner shadow-secondary/20 backdrop-blur">
        Secure tenant:{" "}
        <strong className="text-foreground">Acme Bricks</strong>
      </div>
    </aside>
  );
}
