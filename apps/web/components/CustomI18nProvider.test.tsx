import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomI18nProvider } from "../app/CustomI18nProvider";

function Booking({ locale }: { locale: string }) {
  return (
    <CustomI18nProvider translations={{ greeting: "Booking" }} locale={locale} ns="common">
      <main>
        <h1>Booking</h1>
      </main>
    </CustomI18nProvider>
  );
}

beforeEach(() => {
  document.documentElement.setAttribute("lang", "en");
  document.documentElement.setAttribute("dir", "ltr");
});

afterEach(cleanup);

describe("booking interface language", () => {
  it.each(["en", "de", "it"])("uses %s despite the English browser document", (locale) => {
    const { getByRole } = render(<Booking locale={locale} />);
    expect(document.documentElement.lang).toBe(locale);
    expect(document.documentElement.dir).toBe("ltr");
    expect(getByRole("main").closest("[lang]")?.getAttribute("lang")).toBe(locale);
  });

  it("changes both document attributes and restores the account language on leaving", () => {
    const { rerender, unmount } = render(<Booking locale="de" />);
    rerender(<Booking locale="ar" />);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    rerender(<Booking locale="it" />);
    expect(document.documentElement.lang).toBe("it");
    expect(document.documentElement.dir).toBe("ltr");
    unmount();
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("restores absent original attributes through StrictMode remounts", () => {
    document.documentElement.removeAttribute("lang");
    document.documentElement.removeAttribute("dir");
    const { unmount } = render(
      <StrictMode>
        <Booking locale="de" />
      </StrictMode>
    );
    expect(document.documentElement.lang).toBe("de");
    unmount();
    expect(document.documentElement.hasAttribute("lang")).toBe(false);
    expect(document.documentElement.hasAttribute("dir")).toBe(false);
  });

  it("does not overwrite a later document owner during cleanup", () => {
    const { unmount } = render(<Booking locale="de" />);
    document.documentElement.setAttribute("lang", "ar");
    document.documentElement.setAttribute("dir", "rtl");
    unmount();
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("preserves a later language owner when it shares the booking direction", () => {
    document.documentElement.setAttribute("lang", "ar");
    document.documentElement.setAttribute("dir", "rtl");
    const { unmount } = render(<Booking locale="de" />);
    document.documentElement.setAttribute("lang", "it");
    document.documentElement.setAttribute("dir", "ltr");
    unmount();
    expect(document.documentElement.lang).toBe("it");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it.each(["de", "it", "ar"])("marks server-rendered %s content before JavaScript runs", (locale) => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<Booking locale={locale} />);
    const scope = host.querySelector("main")?.closest("[lang]");
    expect(scope?.getAttribute("lang")).toBe(locale);
    expect(scope?.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(document.documentElement.lang).toBe("en");
  });

  it("hydrates server content without recoverable errors and restores on unmount", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = renderToString(<Booking locale="it" />);
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(host, <Booking locale="it" />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(document.documentElement.lang).toBe("it");
    expect(host.querySelectorAll("main")).toHaveLength(1);
    await act(async () => root?.unmount());
    expect(document.documentElement.lang).toBe("en");
    host.remove();
  });
});
