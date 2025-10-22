"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function LoginForm({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const enablePasswordAuth =
    process.env.NEXT_PUBLIC_ENABLE_PASSWORD_AUTH === "true";
  const [mode, setMode] = useState<"magic" | "password">("magic");

  useEffect(() => {
    setError(null);
    setMessage(null);
    if (mode === "magic") {
      setPassword("");
    }
  }, [mode]);

  const canSubmit = useMemo(() => {
    if (mode === "password") {
      return email.trim().length > 4 && password.trim().length >= 6;
    }
    return email.trim().length > 4;
  }, [mode, email, password]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      const origin =
        typeof window !== "undefined" ? window.location.origin : undefined;

      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          throw error;
        }

        router.push("/dashboard");
        return;
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo:
              siteUrl?.length
                ? `${siteUrl.replace(/\/$/, "")}/auth/confirm?next=/dashboard`
                : origin
                  ? `${origin}/auth/confirm?next=/dashboard`
                  : undefined,
          },
        });

        if (error) {
          throw error;
        }

        setMessage(
          "Magic link sent! Check your inbox to finish signing in. The link expires in 5 minutes.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {mode === "password" ? "Sign in with password" : "Sign in with magic link"}
          </CardTitle>
          <CardDescription>
            {mode === "password"
              ? "Enter your credentials to access Nova Bricks ERP."
              : "We’ll email you a secure, one-time link. No password required."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-6">
            {enablePasswordAuth ? (
              <div className="grid grid-cols-2 rounded-lg border border-border/70 p-1 text-sm">
                <button
                  type="button"
                  onClick={() => setMode("magic")}
                  className={`rounded-md px-3 py-2 transition ${
                    mode === "magic"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  Magic link
                </button>
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  className={`rounded-md px-3 py-2 transition ${
                    mode === "password"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  Password
                </button>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="operator@example.com"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            {mode === "password" ? (
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
            {mode === "magic" && message ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-500">
                {message}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    router.refresh();
                  }}
                  className="font-medium underline underline-offset-4"
                >
                  Send another
                </button>
                .
              </div>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={isLoading || !canSubmit}
            >
              {isLoading
                ? mode === "password"
                  ? "Signing in..."
                  : "Sending link..."
                : mode === "password"
                  ? "Sign in"
                  : "Email me a link"}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Need credentials?{" "}
              <Link
                href="/auth/sign-up"
                className="font-medium text-primary underline underline-offset-4"
              >
                Request access
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
