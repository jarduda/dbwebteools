import { expectDebouncedSearch } from "./search-debounce";
import { test, expect } from "@playwright/test";

test("configure lookup copies and backend formula fields, create and replace relation", async ({
  page,
}) => {
  test.setTimeout(90_000);
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
      const response = await fetch("/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-TOKEN": token },
        body: JSON.stringify({
          name: "Copy and formula browser",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!response.ok) throw new Error("Connection setup failed");
      return (await response.json()).id as number;
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
    .selectOption("z_copy_records");
  await page
    .getByLabel("product_id control", { exact: true })
    .selectOption("lookup");
  await page
    .getByLabel("product_id related table")
    .selectOption("z_copy_catalog");
  await page.getByLabel("product_id key column").selectOption("id");
  await page.getByLabel("product_id display column").selectOption("name");
  await page.getByRole("button", { name: "Add copy mapping" }).click();
  await page.getByLabel("product_id copy 1 source").selectOption("name");
  await page
    .getByLabel("product_id copy 1 destination")
    .selectOption("description");
  await page.getByRole("button", { name: "Add copy mapping" }).click();
  await page.getByLabel("product_id copy 2 source").selectOption("price");
  await page
    .getByLabel("product_id copy 2 destination")
    .selectOption("unit_price");
  await page
    .getByLabel("product_id copy 1 allow editing", { exact: true })
    .check();
  const criteria = page.getByRole("region", {
    name: "product_id lookup criteria",
    exact: true,
  });
  await criteria
    .getByRole("button", { name: "Add filter", exact: true })
    .click();
  await criteria
    .getByLabel("Filter 1 field", { exact: true })
    .selectOption("price");
  await criteria
    .getByLabel("Filter 1 condition", { exact: true })
    .selectOption("gt");
  await criteria.getByLabel("Filter 1 value", { exact: true }).fill("0");
  await page
    .getByLabel("quantity default mode", { exact: true })
    .selectOption("value");
  await page.getByLabel("quantity default value", { exact: true }).fill("2");
  await page
    .getByLabel("product_id default mode", { exact: true })
    .selectOption("value");
  await page
    .getByLabel("product_id default value", { exact: true })
    .fill("9007199254740993");
  await page.getByRole("button", { name: "Add formula field" }).click();
  await page.getByLabel("formula_1 label", { exact: true }).fill("Line total");
  await page
    .getByLabel("formula_1 expression")
    .fill("Round([unit_price] * [quantity], 2)");
  await page.getByRole("button", { name: "Add formula field" }).click();
  await page.getByLabel("formula_2 label", { exact: true }).fill("Summary");
  await page
    .getByLabel("formula_2 expression")
    .fill("Concat(Upper([description]), ' x', [quantity])");
  await page.getByRole("button", { name: "Save layout", exact: true }).click();
  await expect(page.getByText("Layout saved.", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Editor layouts" }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("z_copy_records");
  await expect(page.getByLabel("formula_1 expression")).toHaveValue(
    "Round([unit_price] * [quantity], 2)",
  );
  await expect(
    page.getByLabel("product_id copy 1 allow editing", { exact: true }),
  ).toBeChecked();
  await expect(
    page.getByLabel("product_id copy 2 allow editing", { exact: true }),
  ).not.toBeChecked();
  await expect(page.getByLabel("product_id copy 2 destination")).toHaveValue(
    "unit_price",
  );
  await expect(
    page.getByLabel("quantity default value", { exact: true }),
  ).toHaveValue("2");
  await expect(
    criteria.getByLabel("Filter 1 value", { exact: true }),
  ).toHaveValue("0");
  await page.getByRole("button", { name: "Data browser", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("z_copy_records");
  await page.getByRole("button", { name: "Add record", exact: true }).click();
  let editor = page.getByRole("dialog", { name: "Add a record", exact: true });
  await expect(editor.getByLabel("quantity", { exact: true })).toHaveValue("2");
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Copy Alice",
  );
  await expect(editor.getByLabel("unit_price", { exact: true })).toHaveValue(
    "12.3450",
  );
  await editor
    .getByRole("button", { name: "Choose product_id", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select Copy Bob (42)", exact: true }),
  ).toBeVisible();
  await expectDebouncedSearch(
    page,
    page.getByLabel("Search related records", { exact: true }),
    /\/lookups\/product_id$/,
    "Copy",
  );

  await expect(
    page.getByRole("button", {
      name: "Select Excluded product (43)",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Select Copy Alice (9007199254740993)",
      exact: true,
    })
    .click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Copy Alice",
  );
  await expect(editor.getByLabel("unit_price", { exact: true })).toHaveValue(
    "12.3450",
  );
  await expect(editor.getByLabel("Line total", { exact: true })).toHaveValue(
    "24.69",
  );
  await expect(editor.getByLabel("Summary", { exact: true })).toHaveValue(
    "COPY ALICE x2",
  );
  await expect(
    editor.getByLabel("Line total", { exact: true }),
  ).toHaveAttribute("readonly", "");
  const createRequest = page.waitForRequest((r) =>
    r.url().endsWith("/z_copy_records/create"),
  );
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  const body = (await createRequest).postDataJSON();
  expect(body.values.product_id).toBe("9007199254740993");
  expect(body.values).not.toHaveProperty("formula_1");
  await expect(editor).toHaveCount(0);
  let row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "COPY ALICE x2", exact: true }),
    })
    .last();
  await expect(
    row.getByRole("cell", { name: "24.69", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: /Edit record/ }).click();
  editor = page.getByRole("dialog", { name: "Edit record", exact: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await editor
    .getByRole("button", { name: "Choose product_id", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Copy Bob (42)", exact: true })
    .click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Copy Bob",
  );
  await expect(editor.getByLabel("Line total", { exact: true })).toHaveValue(
    "50.00",
  );
  await editor.getByLabel("quantity", { exact: true }).fill("3");
  await expect(editor.getByLabel("Line total", { exact: true })).toHaveValue(
    "75.00",
  );
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "COPY BOB x3", exact: true }),
    })
    .last();
  await row.getByRole("button", { name: /Edit record/ }).click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Copy Bob",
  );
  await expect(editor.getByLabel("description", { exact: true })).toBeEnabled();
  await expect(editor.getByLabel("unit_price", { exact: true })).toBeDisabled();
  await editor.getByLabel("description", { exact: true }).fill("Custom Bob");
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  row = page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "CUSTOM BOB x3", exact: true }),
    })
    .last();
  await row.getByRole("button", { name: /Edit record/ }).click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Custom Bob",
  );
  await editor
    .getByRole("button", { name: "Choose product_id", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Copy Bob (42)", exact: true })
    .click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Copy Bob",
  );
  await expect(editor.getByLabel("description", { exact: true })).toBeEnabled();
  // Override back to the old stored value after same-key reselection: payload must retain it.
  await editor.getByLabel("description", { exact: true }).fill("Custom Bob");
  await editor
    .getByRole("button", { name: "Save record", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await row.getByRole("button", { name: /Edit record/ }).click();
  await expect(editor.getByLabel("description", { exact: true })).toHaveValue(
    "Custom Bob",
  );
  await expect(editor.getByLabel("unit_price", { exact: true })).toBeDisabled();
  await editor
    .getByRole("button", { name: "Clear product_id", exact: true })
    .click();
  await expect(editor.getByLabel("Line total", { exact: true })).toHaveValue(
    "NULL",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await row.getByRole("button", { name: /Delete record/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete record", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});
