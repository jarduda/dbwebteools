// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectEditor } from "./object-editor";
import { api } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, api: vi.fn() };
});

const schema = {
  version: "v1",
  columns: [
    { name: "id", type: "bigint", sqlType: "bigint", nullable: false, primaryKey: true, autoIncrement: true, generated: false, length: null, precision: 20, scale: 0, default: null, relatedTable: null, relatedKey: null, uniqueKey: true, editBlocked: "Primary keys are managed outside the designer." },
    { name: "title", type: "varchar", sqlType: "varchar(100)", nullable: true, primaryKey: false, autoIncrement: false, generated: false, length: 100, precision: null, scale: null, default: null, relatedTable: null, relatedKey: null, uniqueKey: false, editBlocked: null },
  ],
};
const definition = { fields: [
  { name: "id", label: "Id", readOnly: true, widget: "auto" },
  { name: "title", label: "Title", readOnly: false, widget: "text" },
], view: {} };

function mockApi() {
  vi.mocked(api).mockImplementation(async (url, method = "GET") => {
    if (url === "/connections/1/tables") return ["things"] as never;
    if (url.includes("/schema/tables/things")) return schema as never;
    if (url.endsWith("/tables/things/object") && method === "GET") return definition as never;
    return undefined as never;
  });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Object field workflow", () => {
  it("keeps the list read-only and saves behavior from an accessible edit dialog", async () => {
    mockApi();
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    expect(screen.queryByLabelText("title control")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    const dialog = screen.getByRole("dialog", { name: "Edit database field" });
    expect(dialog).toBeTruthy();
    expect(screen.getByLabelText("Control / behavior")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("title readOnly"));
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api).not.toHaveBeenCalledWith(
      "/admin/connections/1/schema/tables/things/modify-column",
      "POST",
      expect.anything(),
    );
    expect(api).toHaveBeenCalledWith(
      "/admin/connections/1/tables/things/object",
      "PUT",
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "title", readOnly: true }),
        ]),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    fireEvent.change(screen.getByLabelText("Text length"), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/schema/tables/things/modify-column",
        "POST",
        expect.objectContaining({ name: "title", length: 120, type: "text" }),
      ),
    );
  });

  it("creates database fields from control choices without a type dropdown", async () => {
    mockApi();
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.getByRole("dialog", { name: "Add field" })).toBeTruthy();
    expect(screen.queryByLabelText("Column type")).toBeNull();
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "enabled" } });
    fireEvent.change(screen.getByLabelText("Control / behavior"), { target: { value: "checkbox" } });
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api).toHaveBeenCalledWith(
      "/admin/connections/1/schema/tables/things/columns",
      "POST",
      expect.objectContaining({ name: "enabled", type: "boolean" }),
    );
    expect(api).toHaveBeenCalledWith(
      "/admin/connections/1/tables/things/object",
      "PUT",
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "enabled", widget: "checkbox" }),
        ]),
      }),
    );
  });

  it("requires explicit confirmation before deleting and calls delete after approval", async () => {
    mockApi();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Delete field title" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/fields/title"), "DELETE");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete field title" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/tables/things/fields/title",
        "DELETE",
      ),
    );
    confirm.mockRestore();
  });
});
