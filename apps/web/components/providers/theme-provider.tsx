"use client";

import type { ThemeProviderProps } from "next-themes";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
  ...props
}: ThemeProviderProps & { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      {...props}
      themes={props.themes ?? ["light", "dark"]}
      enableSystem={props.enableSystem ?? true}
      attribute={props.attribute ?? "class"}
    >
      {children}
    </NextThemesProvider>
  );
}
