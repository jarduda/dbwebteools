import { test, expect } from "@playwright/test";

test("design tables, typed columns and a relation lookup, then create a related record", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.goto("/");
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { token } = await (await fetch("/api/auth/csrf")).json();
          return (
            await fetch("/api/auth/login", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-CSRF-TOKEN": token,
              },
              body: JSON.stringify({
                username: "admin",
                password: "browser-test-only-password",
              }),
            })
          ).status;
        }),
      { timeout: 70_000, intervals: [1000, 5000] },
    )
    .toBe(200);
  const id = await page.evaluate(
    async ({ port, password }) => {
      const { token } = await (await fetch("/api/auth/csrf")).json();
      const r = await fetch("/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({
          name: "Schema browser",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!r.ok) throw new Error("Connection fixture failed");
      return (await r.json()).id;
    },
    {
      port: process.env.CI ? 3306 : 33079,
      password: process.env.CI ? "ci-disposable-root" : "",
    },
  );
  await page.reload();
  await page
    .getByRole("button", { name: "Table designer", exact: true })
    .click();
  await page
    .getByLabel("Schema connection", { exact: true })
    .selectOption(String(id));
  const parent = "z_schema_parent_" + Date.now(),
    child = "z_schema_child_" + Date.now();
  async function createTable(name: string) {
    await page.getByRole("button", { name: "New table", exact: true }).click();
    await page.getByLabel("New table name", { exact: true }).fill(name);
    await expect(
      page.getByLabel("Primary key name", { exact: true }),
    ).toHaveValue("id");
    await page
      .getByRole("button", { name: "Create table", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Table structure" }),
    ).toContainText("Primary key");
    await expect(
      page.getByRole("button", { name: "Edit column id", exact: true }),
    ).toBeDisabled();
  }
  async function startColumn(name: string, type: string) {
    await page.getByRole("button", { name: "Add column", exact: true }).click();
    await page.getByLabel("Column name", { exact: true }).fill(name);
    await page.getByLabel("Column type", { exact: true }).selectOption(type);
  }
  async function saveColumn() {
    await page
      .getByRole("button", { name: "Create column", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "Add column", exact: true }),
    ).toHaveCount(0);
  }
  await createTable(parent);
  await startColumn("name", "text");
  await page.getByLabel("Text length", { exact: true }).fill("80");
  await saveColumn();
  await page
    .getByRole("button", { name: "Edit column name", exact: true })
    .click();
  await page.getByLabel("Text length", { exact: true }).fill("120");
  await page.getByRole("button", { name: "Save column", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Table structure" }),
  ).toContainText("varchar(120)");
  await createTable(child);
  await startColumn("amount", "decimal");
  await page.getByLabel("Total digits", { exact: true }).fill("14");
  await page.getByLabel("Decimal places", { exact: true }).fill("4");
  await saveColumn();
  await expect(
    page.getByRole("region", { name: "Table structure" }),
  ).toContainText("decimal(14,4)");
  await startColumn("parent_id", "relation");
  await page.getByLabel("Related table", { exact: true }).selectOption(parent);
  await page.getByLabel("Related key", { exact: true }).selectOption("id");
  await page
    .getByLabel("Relation display column", { exact: true })
    .selectOption("name");
  await saveColumn();
  await expect(page.getByRole("status")).toContainText(
    "Foreign key and layout lookup configured",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const addBox = await page
    .getByRole("button", { name: "Add column", exact: true })
    .boundingBox();
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(page.getByLabel("Column name", { exact: true })).toBeVisible();
  await page
    .getByRole("form", { name: "Add column", exact: true })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.screenshot({
    path: "../../artifacts/schema-designer-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Newly created tables are immediately available, without reloading the app.
  await page.getByRole("button", { name: "Data browser", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption(parent);
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Add a record", exact: true });
  await editor.getByLabel("name", { exact: true }).fill("Designer customer");
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption(child);
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  editor = page.getByRole("dialog", { name: "Add a record", exact: true });
  await editor.getByLabel("amount", { exact: true }).fill("12.3456");
  await editor
    .getByRole("button", { name: "Choose parent_id", exact: true })
    .click();
  await page.getByRole("button", { name: /Select.*Designer customer/ }).click();
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "Designer customer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "12.3456", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Table designer", exact: true })
    .click();
  await page
    .getByLabel("Schema connection", { exact: true })
    .selectOption(String(id));
  await page.getByLabel("Schema table", { exact: true }).selectOption(parent);
  await page
    .getByRole("button", { name: "Edit column name", exact: true })
    .click();
  await page.getByLabel("Text length", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save column", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Existing text exceeds");
  await page.screenshot({
    path: "../../artifacts/schema-designer-desktop.png",
    fullPage: true,
  });
});
