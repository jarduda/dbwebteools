// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
it("expires the UI for a protected 401, not forbidden responses or a wrong password", async () => {
  const { api, SESSION_EXPIRED } = await import("./api");
  const event = vi.fn();
  window.addEventListener(SESSION_EXPIRED, event);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 403 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api("/connections")).rejects.toThrow();
  expect(event).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(api("/auth/login")).rejects.toThrow();
  expect(event).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(api("/connections")).rejects.toThrow();
  expect(event).toHaveBeenCalledOnce();
  window.removeEventListener(SESSION_EXPIRED, event);
});
it("ignores stale responses after expiration and fetches a fresh CSRF token for login", async () => {
  const { api, csrf, SESSION_EXPIRED } = await import("./api");
  const event = vi.fn();
  window.addEventListener(SESSION_EXPIRED, event);
  let pending!: (r: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "old-test-token" })),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          pending = r;
        }),
    )
    .mockResolvedValueOnce(new Response("{}", { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  await csrf();
  const stale = api("/connections").catch((e) => e);
  await expect(api("/auth/me")).rejects.toThrow();
  pending(new Response("[]"));
  expect(await stale).toBeInstanceOf(Error);
  expect(event).toHaveBeenCalledOnce();
  fetcher
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "new-test-token" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1 })));
  await api("/auth/login", "POST", { username: "test" });
  expect(fetcher.mock.calls.at(-1)?.[1].headers["X-CSRF-TOKEN"]).toBe(
    "new-test-token",
  );
  window.removeEventListener(SESSION_EXPIRED, event);
});
it("network failures do not discard the session", async () => {
  const { api, SESSION_EXPIRED } = await import("./api");
  const event = vi.fn();
  window.addEventListener(SESSION_EXPIRED, event);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  await expect(api("/connections")).rejects.toThrow("Offline");
  expect(event).not.toHaveBeenCalled();
  window.removeEventListener(SESSION_EXPIRED, event);
});
