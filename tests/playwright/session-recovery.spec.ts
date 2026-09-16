import { test, expect } from "@playwright/test";
test("expired cookies return to login on API access, tab return and browser reopen, preserving record URL", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  async function login() {
    await page.getByLabel("Username", { exact: true }).fill("admin");
    await page
      .getByLabel("Password", { exact: true })
      .fill("browser-test-only-password");
    await page.getByRole("button", { name: "Sign in →", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
  }
  await page.goto("/");
  await login();
  const setup = await page.evaluate(async () => {
    const connections = await (await fetch("/api/connections")).json();
    const c =
      connections.find(
        (x: { name: string }) => x.name === "Field security browser",
      ) || connections[0];
    const { token } = await (await fetch("/api/auth/csrf")).json();
    const r = await fetch("/api/admin/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
      body: JSON.stringify({
        id: 0,
        connectionId: c.id,
        table: "z_field_records",
        name: "Session record",
        linkColumn: "name",
        tabs: [],
      }),
    });
    if (!r.ok) throw new Error("Page setup failed");
    return { id: (await r.json()).id };
  });
  const link = `/#page/${setup.id}/${encodeURIComponent(JSON.stringify({ id: "9007199254740993" }))}`;
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Session record", exact: true }),
  ).toBeVisible();
  // Forbidden responses are not expired sessions.
  const endpoint = `**/api/pages/${setup.id}/record?*`;
  await page.route(endpoint, (r) =>
    r.fulfill({
      status: 403,
      json: { title: "No permission for this record" },
    }),
  );
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No permission");
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page.unroute(endpoint);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Session record", exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  await page.getByRole("button", { name: "Refresh page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("session has expired");
  expect(page.url()).toContain("#page/");
  // Bad passwords remain an ordinary login error, not a redirect loop.
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await login();
  await expect(
    page.getByRole("heading", { name: "Session record", exact: true }),
  ).toBeVisible();
  // Simulate a suspended browser tab returning with an expired cookie, with no data action.
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  await login();
  await expect(
    page.getByRole("heading", { name: "Session record", exact: true }),
  ).toBeVisible();
  await context.clearCookies();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
  expect(page.url()).toContain("#page/");
  await login();
  await expect(
    page.getByRole("heading", { name: "Session record", exact: true }),
  ).toBeVisible();
  // Fresh anti-forgery token after reauthentication: a protected POST succeeds.
  const status = await page.evaluate(async () => {
    const { token } = await (await fetch("/api/auth/csrf")).json();
    return (
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-TOKEN": token },
      })
    ).status;
  });
  expect(status).toBe(204);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(
    page.getByRole("heading", { name: "Sign in to your workspace" }),
  ).toBeVisible();
});
