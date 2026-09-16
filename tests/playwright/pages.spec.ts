import { test, expect } from "@playwright/test";

test("define pages and drill through related tabs with record keys and browser history", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
      const headers = {
        "Content-Type": "application/json",
        "X-CSRF-TOKEN": token,
      };
      const r = await fetch("/api/admin/connections", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Pages browser",
          host: "127.0.0.1",
          port,
          database: "dbweb_tests",
          username: "root",
          password,
          verifyTls: false,
        }),
      });
      if (!r.ok) throw new Error("Connection failed");
      const { id } = await r.json();
      const layout = await fetch(
        `/api/admin/connections/${id}/tables/z_page_customers/layout`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify([
            {
              name: "id",
              label: "ID",
              section: "",
              order: 0,
              hidden: true,
              readOnly: true,
              widget: "auto",
              showInList: false,
            },
            {
              name: "name",
              label: "Customer name",
              section: "Contact",
              order: 1,
              hidden: false,
              readOnly: false,
              widget: "text",
            },
          ]),
        },
      );
      if (!layout.ok) throw new Error("Layout failed");
      return id as number;
    },
    {
      port: process.env.CI ? 3306 : 33079,
      password: process.env.CI ? "ci-disposable-root" : "",
    },
  );
  await page.reload();
  await page.getByRole("button", { name: "Page editor", exact: true }).click();
  async function start(name: string, table: string, link: string) {
    await page.getByRole("button", { name: "New page", exact: true }).click();
    await page.getByLabel("Page name", { exact: true }).fill(name);
    await page
      .getByLabel("Page connection", { exact: true })
      .selectOption(String(id));
    await page.getByLabel("Main table", { exact: true }).selectOption(table);
    await page
      .getByLabel("List drill-down column", { exact: true })
      .selectOption(link);
  }
  async function tab(
    n: number,
    label: string,
    table: string,
    parent: string,
    related: string,
    columns: string[],
    target?: number,
    link?: string,
  ) {
    await page
      .getByRole("button", { name: "Add related tab", exact: true })
      .click();
    await page.getByLabel(`Tab ${n} label`, { exact: true }).fill(label);
    await page
      .getByLabel(`Tab ${n} table`, { exact: true })
      .selectOption(table);
    await page
      .getByLabel(`Tab ${n} parent column`, { exact: true })
      .selectOption(parent);
    await page
      .getByLabel(`Tab ${n} related column`, { exact: true })
      .selectOption(related);
    for (const c of columns)
      await page.getByLabel(`Tab ${n} show ${c}`, { exact: true }).check();
    if (target) {
      await page
        .getByLabel(`Tab ${n} destination page`, { exact: true })
        .selectOption(String(target));
      await page
        .getByLabel(`Tab ${n} drill-down column`, { exact: true })
        .selectOption(link!);
    }
  }
  async function save() {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/pages") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save page", exact: true }).click();
    const r = await response;
    expect(r.status()).toBe(200);
    await expect(page.getByText("Page saved.", { exact: true })).toBeVisible();
    return (await r.json()).id as number;
  }
  await start("Line page", "z_page_lines", "title");
  const linePage = await save();
  await start("Order page", "z_page_orders", "title");
  await tab(
    1,
    "Lines",
    "z_page_lines",
    "id",
    "order_id",
    ["title"],
    linePage,
    "title",
  );
  const orderPage = await save();
  await start("Customer page", "z_page_customers", "name");
  await tab(
    1,
    "Orders",
    "z_page_orders",
    "id",
    "customer_id",
    ["title", "amount"],
    orderPage,
    "title",
  );
  await tab(2, "Amounts", "z_page_orders", "id", "customer_id", ["amount"]);
  const customerPage = await save();
  await page.reload();
  await page.getByRole("button", { name: "Page editor", exact: true }).click();
  await page
    .getByLabel("Page", { exact: true })
    .selectOption(String(customerPage));
  await expect(
    page.getByLabel("Tab 1 destination page", { exact: true }),
  ).toHaveValue(String(orderPage));
  await expect(
    page.getByLabel("Tab 2 show amount", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Data browser", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Connection", exact: true })
    .selectOption(String(id));
  await page
    .getByRole("combobox", { name: "Table", exact: true })
    .selectOption("z_page_customers");
  await page.getByRole("link", { name: "Page Alice", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Customer page", exact: true }),
  ).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain("9007199254740993");
  await expect(page.getByRole("region", { name: "Main record" })).toContainText(
    "Customer name",
  );
  await expect(page.getByRole("region", { name: "Main record" })).toContainText(
    "alice.page@example.test",
  );
  let panel = page.getByRole("tabpanel");
  await expect(
    panel.getByRole("link", { name: "Alice order", exact: true }),
  ).toBeVisible();
  await expect(panel).not.toContainText("Bob private order");
  await expect(panel.getByRole("columnheader")).toHaveText(["title", "amount"]);
  await panel.getByLabel("Search Orders", { exact: true }).fill("Bob");
  await expect(
    panel.getByText("No related records found.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Amounts", exact: true }).click();
  await expect(page.getByRole("tabpanel").getByRole("columnheader")).toHaveText(
    ["amount"],
  );
  await page
    .getByRole("tab", { name: "Amounts", exact: true })
    .press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Orders", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("tabpanel")
    .getByRole("link", { name: "Alice order", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Order page", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tabpanel")
    .getByRole("link", { name: "Alice second line", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Line page", exact: true }),
  ).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain('"seq":2');
  const bookmark = page.url();
  await page.reload();
  await expect(page.getByRole("region", { name: "Main record" })).toContainText(
    "Alice second line",
  );
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Order page", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Customer page", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("tab", { name: "Orders", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page
      .getByRole("tabpanel")
      .getByRole("link", { name: "Alice order", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/record-page-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Edit record", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(editor.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Page Alice",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto(bookmark);
  await expect(
    page.getByRole("heading", { name: "Line page", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
