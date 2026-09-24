// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: mocks.api,
}));

import { RecordEditor } from "./main";

afterEach(() => {
  cleanup();
  mocks.api.mockReset();
});

it("requests formula recalculation with only fields changed since the last result", async () => {
  mocks.api.mockImplementation(
    async (
      _url: string,
      _method: string,
      body: { values: Record<string, unknown>; changedFields?: string[] },
    ) => {
      if (!body.changedFields)
        return {
          values: { total: "4", greeting: "Initial" },
          columns: [{ name: "total" }, { name: "greeting" }],
        };
      if (body.changedFields.includes("price"))
        return { values: { total: "6" }, columns: [{ name: "total" }] };
      return { values: {}, columns: [] };
    },
  );
  const stored = (name: string, type = "varchar") => ({
    name,
    type,
    nullable: true,
    primaryKey: false,
    generated: false,
    autoIncrement: false,
    default: null,
  });
  const virtual = (name: string, formula: string) => ({
    ...stored(name),
    generated: true,
    canWrite: false,
    field: {
      name,
      label: name,
      section: "",
      order: 10,
      hidden: false,
      readOnly: true,
      widget: "formula",
      formula,
    },
  });
  const total = virtual("total", "[price] * 2");
  const greeting = virtual("greeting", "Concat([name], [qty])");

  render(
    <RecordEditor
      base="/connections/1/tables/items"
      columns={[
        stored("price", "decimal"),
        stored("qty", "int"),
        stored("name"),
        stored("notes"),
        total,
        greeting,
      ]}
      fields={[total.field, greeting.field]}
      row={{
        values: { price: "2", qty: "1", name: "A", notes: "before" },
        joinedValues: { total: "4", greeting: "Initial" },
        version: "v1",
      }}
      close={() => {}}
      save={async () => {}}
    />,
  );

  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("notes"), {
    target: { value: "after" },
  });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(mocks.api.mock.calls[1][2].changedFields).toEqual(["notes"]);
  expect((screen.getByLabelText("total") as HTMLInputElement).value).toBe("4");
  expect((screen.getByLabelText("greeting") as HTMLInputElement).value).toBe(
    "Initial",
  );

  fireEvent.change(screen.getByLabelText("price"), { target: { value: "3" } });
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3));
  expect(mocks.api.mock.calls[2][2].changedFields).toEqual(["price"]);
  await waitFor(() =>
    expect((screen.getByLabelText("total") as HTMLInputElement).value).toBe("6"),
  );
  expect((screen.getByLabelText("greeting") as HTMLInputElement).value).toBe(
    "Initial",
  );
});
