import { test, expect } from "@playwright/test";

test("dropdown display formula follows selection and saves only the key", async ({
  page,
}) => {
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
      const headers = {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": token,
      };
      const result = await fetch("/api/admin/connections", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Dropdown formulas",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!result.ok) throw new Error("Connection setup failed");
      const { id } = await result.json();
      const saved = await fetch(
        `/api/admin/connections/${id}/tables/z_formula_dropdown_records/layout`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify([
            {
              name: "status",
              label: "Status",
              section: "",
              order: 2,
              hidden: false,
              readOnly: false,
              widget: "dropdown",
              options: [
                { key: "a", display: "Awaiting review" },
                { key: "b", display: "Review complete" },
              ],
            },
          ]),
        },
      );
      if (!saved.ok) throw new Error("Layout setup failed");
      return id as number;
    },
    {
      port: process.env.CI ? 3306 : 33079,
      password: process.env.CI ? "ci-disposable-root" : "",
    },
  );
  await page.reload();
  await page.getByRole("button", { name: "Object editor" }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("z_formula_dropdown_records");
  await page.getByRole("button", { name: "Add formula field" }).click();
  await page
    .getByLabel("formula_1 label", { exact: true })
    .fill("Status summary");
  await page
    .getByLabel("formula_1 expression")
    .fill(
      "Concat('Status: ', Coalesce(DropdownDisplay('status', [status]), 'Unknown'))",
    );
  await page.getByRole("button", { name: "Save object", exact: true }).click();
  await expect(
    page.getByText("Object saved. Application behavior updated.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Data browser", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("z_formula_dropdown_records");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Add a record", exact: true });
  const title = "Dropdown formula " + Date.now();
  await editor.getByLabel("title", { exact: true }).fill(title);
  await expect(
    editor.getByLabel("Status summary", { exact: true }),
  ).toHaveValue("Status: Unknown");
  await editor.getByLabel("Status", { exact: true }).selectOption("a");
  await expect(
    editor.getByLabel("Status summary", { exact: true }),
  ).toHaveValue("Status: Awaiting review");
  const request = page.waitForRequest((r) =>
    r.url().endsWith("/z_formula_dropdown_records/create"),
  );
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  const payload = (await request).postDataJSON();
  expect(payload.values.status).toBe("a");
  expect(payload.values).not.toHaveProperty("formula_1");
  await expect(editor).toHaveCount(0);
  const row = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: title, exact: true }) });
  await expect(
    row.getByRole("cell", { name: "Status: Awaiting review", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: /Edit record/ }).click();
  editor = page.getByRole("dialog", { name: "Edit record", exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.getByLabel("Status", { exact: true }).selectOption("b");
  await expect(
    editor.getByLabel("Status summary", { exact: true }),
  ).toHaveValue("Status: Review complete");
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await expect(
    row.getByRole("cell", { name: "Status: Review complete", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: /Delete record/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await expect(row).toHaveCount(0);
});
