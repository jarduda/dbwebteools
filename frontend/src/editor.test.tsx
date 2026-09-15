// @vitest-environment jsdom
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { RecordEditor } from "./main";
afterEach(cleanup);
const columns = [
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
    name: "name",
    type: "varchar",
    nullable: false,
    primaryKey: false,
    generated: false,
    autoIncrement: false,
    default: null,
  },
];
describe("Record editor", () => {
  it("omits generated primary keys and submits editable fields", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordEditor
        columns={columns}
        fields={[]}
        row={null}
        close={() => {}}
        save={save}
      />,
    );
    expect((screen.getByLabelText("id") as HTMLInputElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText("name"), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByText("Save record"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "Alice" }));
  });
  it("keeps the form open and reports conflict errors", async () => {
    render(
      <RecordEditor
        columns={columns}
        fields={[]}
        row={{ values: { id: 1, name: "Alice" }, version: "old" }}
        close={() => {}}
        save={async () => {
          throw new Error("Record changed");
        }}
      />,
    );
    fireEvent.click(screen.getByText("Save record"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Record changed"),
    );
  });
});

describe("Lookup editor validation", () => {
  it("requires selection for a required relation instead of submitting a blank key", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordEditor
        columns={[{ ...columns[1], name: "person_id", type: "bigint" }]}
        fields={[
          {
            name: "person_id",
            label: "Customer",
            section: "",
            order: 0,
            hidden: false,
            readOnly: false,
            widget: "lookup",
            lookup: {
              table: "people",
              keyColumn: "id",
              displayColumn: "name",
              searchColumns: [],
            },
          },
        ]}
        row={null}
        close={() => {}}
        save={save}
      />,
    );
    fireEvent.click(screen.getByText("Save record"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Select a related record for Customer.",
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("leaves an optional relation omitted so a database default can apply", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <RecordEditor
        columns={[
          { ...columns[1], name: "person_id", type: "bigint", nullable: true },
        ]}
        fields={[
          {
            name: "person_id",
            label: "Customer",
            section: "",
            order: 0,
            hidden: false,
            readOnly: false,
            widget: "lookup",
            lookup: {
              table: "people",
              keyColumn: "id",
              displayColumn: "name",
              searchColumns: [],
            },
          },
        ]}
        row={null}
        close={() => {}}
        save={save}
      />,
    );
    fireEvent.click(screen.getByText("Save record"));
    await waitFor(() => expect(save).toHaveBeenCalledWith({}));
  });
});
