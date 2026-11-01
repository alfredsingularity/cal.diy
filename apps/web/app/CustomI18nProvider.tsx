"use client";

import { dir } from "i18next";
import type { ReactNode } from "react";
import { createContext, useLayoutEffect, useMemo } from "react";

type CustomI18nContextType = {
  translations: Record<string, string>;
  ns: string;
  locale: string;
};

export const CustomI18nContext = createContext<CustomI18nContextType | null>(null);

export function CustomI18nProvider({
  children,
  translations,
  locale,
  ns,
}: CustomI18nContextType & {
  children: ReactNode;
}) {
  const direction = dir(locale);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.getAttribute("lang");
    const previousDirection = root.getAttribute("dir");
    root.setAttribute("lang", locale);
    root.setAttribute("dir", direction);

    // Booking overrides must not leak into the persistent account layout after navigation.
    return () => {
      if (root.getAttribute("lang") === locale && root.getAttribute("dir") === direction) {
        if (previousLanguage === null) root.removeAttribute("lang");
        else root.setAttribute("lang", previousLanguage);
        if (previousDirection === null) root.removeAttribute("dir");
        else root.setAttribute("dir", previousDirection);
      }
    };
  }, [locale, direction]);

  // Memoize the value to prevent re-renders unless the data changes
  const value = useMemo(
    () => ({
      translations,
      locale,
      ns,
    }),
    [locale, ns]
  );

  return (
    <CustomI18nContext.Provider value={value}>
      {/* The event language is already known here during server rendering, before hydration. */}
      <div lang={locale} dir={direction} style={{ display: "contents" }}>
        {children}
      </div>
    </CustomI18nContext.Provider>
  );
}
