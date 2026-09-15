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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
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

test("configure a relation and select, search, reopen and clear its key", async ({
  page,
}) => {
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
  const id = await page.evaluate(
    async ({ port, password }) => {
      const { token } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch("/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({
          name: "Lookup test database",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!r.ok) throw new Error("Lookup connection setup failed");
      return (await r.json()).id as number;
    },
    {
      port: process.env.CI ? 3306 : 33079,
      password: process.env.CI ? "ci-disposable-root" : "",
    },
  );
  await page.reload();
  await page.getByRole("button", { name: "Editor layouts" }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("lookup_orders");
  await page.getByLabel("person_id control").selectOption("lookup");
  await page.getByLabel("person_id label", { exact: true }).fill("Customer");
  await page
    .getByLabel("person_id related table")
    .selectOption("lookup_people");
  await page.getByLabel("person_id key column").selectOption("id");
  await page.getByLabel("person_id display column").selectOption("name");
  await page.getByLabel("person_id search email").check();
  await page.getByRole("button", { name: "Save layout" }).click();
  await expect(page.getByText("Layout saved.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Data browser" }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("lookup_orders");
  await page.getByRole("button", { name: "Add record" }).click();
  const editor = page.getByRole("dialog", {
    name: "Add a record",
    exact: true,
  });
  await editor
    .getByLabel("title", { exact: true })
    .fill("Lookup browser order");
  await editor.getByRole("button", { name: "Choose Customer" }).click();
  const lookup = page.getByRole("dialog", {
    name: "Select Customer",
    exact: true,
  });
  await expect(lookup).toBeVisible();
  await lookup.getByLabel("Search related records").fill("no-such-person");
  await expect(
    lookup.getByText("No matching records. Try another search."),
  ).toBeVisible();
  await lookup.getByLabel("Search related records").fill("9007199254740993");
  await expect(
    lookup.getByRole("button", {
      name: "Select Alice Friendly (9007199254740993)",
    }),
  ).toBeVisible();
  await lookup.getByLabel("Search related records").fill("alice.lookup@");
  await lookup
    .getByRole("button", { name: "Select Alice Friendly (9007199254740993)" })
    .click();
  await expect(lookup).toHaveCount(0);
  await expect(editor.getByLabel("Customer", { exact: true })).toHaveValue(
    "Alice Friendly",
  );
  await editor.getByRole("button", { name: "Save record" }).click();
  await expect(editor).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: "Lookup browser order" });
  await expect(row).toContainText("Alice Friendly");
  const stored = await page.evaluate(
    async (id) =>
      (
        await (
          await fetch(`/api/connections/${id}/tables/lookup_orders/records`)
        ).json()
      ).rows.find(
        (r: { values: { title: string } }) =>
          r.values.title === "Lookup browser order",
      ).values.person_id,
    id,
  );
  expect(stored).toBe("9007199254740993");
  await row.getByRole("button", { name: /Edit record/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(edit.getByLabel("Customer", { exact: true })).toHaveValue(
    "Alice Friendly",
  );
  await edit.getByRole("button", { name: "Choose Customer" }).click();
  await lookup.getByLabel("Search related records").fill("Bob");
  await expect(
    lookup.getByRole("button", { name: "Select Bob Friendly (42)" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../artifacts/lookup-mobile.png",
    fullPage: true,
  });
  expect(
    await lookup.evaluate(
      (d) => d.getBoundingClientRect().width <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(lookup).toHaveCount(0);
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel("Customer", { exact: true })).toHaveValue(
    "Alice Friendly",
  );
  await edit.getByRole("button", { name: "Choose Customer" }).click();
  await lookup
    .getByRole("button", { name: "Select Bob Friendly (42)" })
    .click();
  await expect(edit.getByLabel("Customer", { exact: true })).toHaveValue(
    "Bob Friendly",
  );
  await edit.getByRole("button", { name: "Save record" }).click();
  await expect(row).toContainText("Bob Friendly");
  await row.getByRole("button", { name: /Edit record/ }).click();
  await edit.getByRole("button", { name: "Clear Customer" }).click();
  await edit.getByRole("button", { name: "Save record" }).click();
  await expect(row).toContainText("NULL");
  await row.getByRole("button", { name: /Delete record/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});
