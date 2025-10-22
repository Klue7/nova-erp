"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Menu } from "lucide-react";

import { MODULE_LINKS } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

export function ProtectedHeader() {
  const pathname = usePathname();
  const activeModule =
    MODULE_LINKS.find((link) => pathname.startsWith(link.href)) ??
    MODULE_LINKS[0];

  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);
    };
    fetchProfile();
  }, []);

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/70 bg-background/95 px-4">
      <div className="flex items-center gap-3">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 sm:w-80">
            <nav className="mt-8 flex flex-col gap-2">
              {MODULE_LINKS.map((link) => {
                const isActive = pathname.startsWith(link.href);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border border-transparent px-3 py-2 transition",
                      isActive
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "text-muted-foreground hover:border-border hover:bg-muted/80 hover:text-foreground",
                    )}
                  >
                    <link.icon className="mt-1 h-4 w-4" aria-hidden />
                    <div>
                      <p className="text-sm font-medium">{link.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {link.description}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Module
          </p>
          <h1 className="text-xl font-semibold text-foreground">
            {activeModule.label}
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Notifications">
          <Bell className="h-5 w-5" aria-hidden />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-muted"
            >
              <Avatar>
                <AvatarFallback>
                  {(userEmail?.charAt(0) ?? "U").toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {userEmail ?? "Signed in"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/">
                <User className="mr-2 h-4 w-4" aria-hidden />
                Landing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="flex w-full items-center text-sm"
                >
                  <LogOut className="mr-2 h-4 w-4" aria-hidden />
                  Sign out
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
