// @vitest-environment jsdom
import React, { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, it, expect } from "vitest";
import { ListViewEditor, filterOperators, filterSummary } from "./list-view";
import { type Column, type ListView, type Field } from "./api";
const column: Column = {
  name: "amount",
  type: "decimal",
  nullable: true,
  primaryKey: false,
  generated: false,
  autoIncrement: false,
  default: null,
};
afterEach(cleanup);
it("only offers text matching for text columns and keeps large numeric inputs as strings", () => {
  expect(filterOperators(column).map((x) => x[0])).not.toContain("contains");
  expect(
    filterOperators({ ...column, type: "varchar" }).map((x) => x[0]),
  ).toContain("contains");
  function Editor() {
    const [value, change] = useState<ListView>({});
    return (
      <>
        <ListViewEditor
          value={value}
          change={change}
          columns={[column]}
          fields={[]}
        />
        <output>{JSON.stringify(value)}</output>
      </>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByRole("button", { name: "Add filter" }));
  fireEvent.change(screen.getByLabelText("Filter 1 value"), {
    target: { value: "9007199254740993.1234" },
  });
  expect(screen.getByRole("status").textContent).toContain(
    '"value":"9007199254740993.1234"',
  );
  fireEvent.change(screen.getByLabelText("Filter 1 condition"), {
    target: { value: "isNull" },
  });
  expect(screen.queryByLabelText("Filter 1 value")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove filter 1" }));
  expect(screen.getByRole("status").textContent).toContain('"filters":[]');
});
it("summarizes filters with configured labels and dropdown display values", () => {
  const fields: Field[] = [
    {
      name: "status",
      label: "State",
      section: "",
      order: 0,
      hidden: false,
      readOnly: false,
      widget: "dropdown",
      options: [{ key: "a", display: "Active" }],
    },
  ];
  expect(
    filterSummary(
      {
        match: "any",
        filters: [
          { column: "status", operator: "eq", value: "a" },
          { column: "amount", operator: "isNull" },
        ],
      },
      fields,
    ),
  ).toBe("State Equals Active OR amount Is NULL");
});
