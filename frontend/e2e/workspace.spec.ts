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
