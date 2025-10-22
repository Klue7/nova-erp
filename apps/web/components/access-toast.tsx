"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { toast } from "@/hooks/use-toast";

const TOAST_PARAM = "toast";

export function AccessToast() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const toastType = searchParams.get(TOAST_PARAM);
    if (!toastType) {
      return;
    }

    if (toastType === "access-denied") {
      toast({
        title: "Access denied",
        description: "You do not have permission to view that module.",
        variant: "destructive",
      });
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete(TOAST_PARAM);
    const nextUrl = params.size > 0 ? `${pathname}?${params.toString()}` : pathname;
    router.replace(nextUrl, { scroll: false });
  }, [pathname, router, searchParams]);

  return null;
}
