import {
  expect,
  type Page,
  type Locator,
  type Request,
} from "@playwright/test";

// Advance browser time deterministically: typing more slowly than the old
// 150–300 ms delays must still produce one request only after the 500 ms pause.
export async function expectDebouncedSearch(
  page: Page,
  input: Locator,
  path: RegExp,
  text: string,
) {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const searches: string[] = [];
  let settings = 0;
  const record = (r: Request) => {
    const url = new URL(r.url());
    if (path.test(url.pathname))
      searches.push(url.searchParams.get("search") || "");
    if (url.pathname.endsWith("/settings")) settings++;
  };
  page.on("request", record);
  try {
    for (let i = 1; i <= text.length; i++) {
      await input.fill(text.slice(0, i));
      if (i < text.length) await page.clock.runFor(350);
      expect(searches).toEqual([]);
    }
    await page.clock.runFor(499);
    expect(searches).toEqual([]);
    const result = page.waitForResponse((r) =>
      path.test(new URL(r.url()).pathname),
    );
    await page.clock.runFor(1);
    expect((await result).ok()).toBe(true);
    expect(searches).toEqual([text]);
    expect(settings).toBe(0);
    await expect(input).toBeFocused();
    // Clearing also coalesces into one request after the same quiet period.
    await input.fill("");
    await page.clock.runFor(499);
    expect(searches).toEqual([text]);
    const cleared = page.waitForResponse((r) =>
      path.test(new URL(r.url()).pathname),
    );
    await page.clock.runFor(1);
    expect((await cleared).ok()).toBe(true);
    expect(searches).toEqual([text, ""]);
  } finally {
    page.off("request", record);
    await page.clock.resume();
  }
}
