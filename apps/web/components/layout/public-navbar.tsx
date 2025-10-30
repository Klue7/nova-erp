"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { PROTECTED_PATH_PREFIXES } from "@/lib/navigation";

export function PublicNavbar() {
  const pathname = usePathname();

  const isProtectedRoute = pathname
    ? PROTECTED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    : false;

  if (isProtectedRoute) {
    return null;
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-secondary/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="group flex items-center gap-2 font-semibold tracking-tight text-foreground transition hover:text-primary"
          >
            <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shadow-inner ring-1 ring-primary/40">
              <Image
                src="/images/logo.png"
                alt="Nova Bricks"
                width={20}
                height={20}
                className="h-5 w-5"
                priority
              />
            </span>
            <span className="text-lg">Nova Bricks ERP</span>
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
          <Button asChild className="bg-primary text-primary-foreground shadow-sm hover:bg-primary/90">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
