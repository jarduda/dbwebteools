// @vitest-environment jsdom
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { listColumns } from "./layout-fields";
import { RecordEditor } from "./main";
import { type Column, type Field } from "./api";
const columns: Column[] = [
  {
    name: "id",
    type: "int",
    nullable: false,
    primaryKey: true,
    generated: false,
    autoIncrement: true,
    default: null,
  },
  {
    name: "title",
    type: "varchar",
    nullable: false,
    primaryKey: false,
    generated: false,
    autoIncrement: false,
    default: null,
  },
  {
    name: "joined_1",
    type: "varchar",
    nullable: true,
    primaryKey: false,
    generated: true,
    autoIncrement: false,
    default: null,
  },
];
const fields: Field[] = [
  {
    name: "id",
    label: "ID",
    section: "",
    order: 0,
    hidden: false,
    readOnly: true,
    widget: "auto",
    showInList: false,
  },
  {
    name: "title",
    label: "Title",
    section: "",
    order: 1,
    hidden: true,
    readOnly: false,
    widget: "text",
    showInList: true,
    listOrder: 2,
  },
  {
    name: "joined_1",
    label: "Customer email",
    section: "",
    order: 2,
    hidden: false,
    readOnly: true,
    widget: "join",
    showInList: true,
    listOrder: 1,
    join: {
      sourceColumn: "id",
      table: "people",
      keyColumn: "id",
      valueColumn: "email",
    },
  },
];
afterEach(cleanup);
it("keeps list visibility independent from editor visibility and uses list order", () => {
  expect(listColumns(columns, fields).map((c) => c.name)).toEqual([
    "joined_1",
    "title",
  ]);
  expect(listColumns(columns, []).map((c) => c.name)).toEqual([
    "id",
    "title",
    "joined_1",
  ]);
  expect(
    listColumns(
      columns,
      fields.map((f) => ({ ...f, showInList: false })),
    ),
  ).toEqual([]);
});
it("renders joined values read-only and never submits them with source changes", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(
    <RecordEditor
      columns={columns}
      fields={fields.map((f) => ({ ...f, hidden: false }))}
      row={{
        values: { id: 1, title: "Before" },
        version: "v",
        joinedValues: { joined_1: "customer@example.test" },
      }}
      close={() => {}}
      save={save}
    />,
  );
  expect(
    (screen.getByLabelText("Customer email") as HTMLInputElement).readOnly,
  ).toBe(true);
  expect(
    (screen.getByLabelText("Customer email") as HTMLInputElement).value,
  ).toBe("customer@example.test");
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "After" },
  });
  fireEvent.click(screen.getByText("Save record"));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ title: "After" }));
});
