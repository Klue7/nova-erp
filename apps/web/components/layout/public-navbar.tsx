"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { PROTECTED_PATH_PREFIXES } from "@/lib/navigation";
import { cn } from "@/lib/utils";

export function PublicNavbar() {
  const pathname = usePathname();

  const isProtectedRoute = pathname
    ? PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    : false;

  if (isProtectedRoute) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className={cn(
              "font-semibold tracking-tight",
              "text-lg text-primary hover:text-primary/80",
            )}
          >
            Nova Bricks ERP
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <Link
              href="#modules"
              className="transition-colors hover:text-foreground"
            >
              Modules
            </Link>
            <Link
              href="#quick-actions"
              className="transition-colors hover:text-foreground"
            >
              Quick Actions
            </Link>
            <Link
              href="#platform"
              className="transition-colors hover:text-foreground"
            >
              Platform
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher />
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
