import { test, expect } from "@playwright/test";
test("desktop and mobile workspace with administration", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Data browser", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Users & roles" }).click();
  await expect(
    page.getByRole("heading", { name: "Users & roles", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New user" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add connection" }),
  ).toBeVisible();
  await page.screenshot({ path: "../artifacts/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Data browser" }).click();
  await expect(
    page.getByRole("heading", { name: "Data browser", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../artifacts/mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("browse, create, edit and delete MariaDB records", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-test-only-password");
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(
    page.getByRole("heading", { name: "Data browser", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    async ({ port, password }) => {
      const { token } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch("/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({
          name: "Browser test database",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!r.ok) throw new Error("Test connection setup failed");
    },
    {
      port: process.env.CI ? 3306 : 33079,
      password: process.env.CI ? "ci-disposable-root" : "",
    },
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "browser_records", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add record" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("name", { exact: true })
    .fill("Browser CRUD test");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Browser CRUD test" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Edit record/ }).click();
  await page
    .getByRole("dialog")
    .getByLabel("name", { exact: true })
    .fill("Browser CRUD updated");
  await page.getByRole("button", { name: "Save record" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const updated = page
    .getByRole("row")
    .filter({ hasText: "Browser CRUD updated" });
  await expect(updated).toBeVisible();
  await page.screenshot({
    path: "../artifacts/records-desktop.png",
    fullPage: true,
  });
  await updated.getByRole("button", { name: /Delete record/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(updated).toHaveCount(0);
});
