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
