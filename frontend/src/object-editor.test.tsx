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

function mockApi(objectDefinition = definition) {
  vi.mocked(api).mockImplementation(async (url, method = "GET") => {
    if (url === "/connections/1/tables") return ["things"] as never;
    if (url.includes("/schema/tables/things")) return schema as never;
    if (url.endsWith("/tables/things/object") && method === "GET") return objectDefinition as never;
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

  it("configures an exact positional mask and saves it in object metadata", async () => {
    mockApi();
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    expect(screen.queryByLabelText("Input mask type")).toBeNull();
    expect(screen.queryByLabelText("Allowed mask characters")).toBeNull();
    const patternInput = screen.getByLabelText("Input mask pattern");
    expect(patternInput.getAttribute("aria-describedby")).toContain("input-mask-pattern-help");
    fireEvent.change(patternInput, { target: { value: "?" } });
    expect(patternInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain(
      "An optional marker must follow a mask position.",
    );
    expect(
      (screen.getByRole("button", { name: "Save field" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(patternInput, {
      target: { value: "AA-##?" },
    });
    expect(screen.getByText(/User tip: Format: AA-##\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/tables/things/object",
        "PUT",
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: "title",
              mask: { pattern: "AA-##?" },
            }),
          ]),
        }),
      ),
    );
  });

  it("offers a numbers-only mask without exposing legacy character rules", async () => {
    mockApi();
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    fireEvent.click(screen.getByLabelText("Numbers only"));
    expect(screen.getByText(/User tip: Use at least 1 characters. Allowed: numbers/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/tables/things/object",
        "PUT",
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: "title",
              mask: {
                characterSet: "digits",
                minimumLength: 1,
                requiredCharacters: "",
              },
            }),
          ]),
        }),
      ),
    );
  });

  it("identifies and removes a legacy custom rule without misrepresenting it", async () => {
    mockApi({
      ...definition,
      fields: definition.fields.map((field) =>
        field.name === "title"
          ? {
              ...field,
              mask: {
                characterSet: "digits",
                minimumLength: 6,
                requiredCharacters: "-",
              },
            }
          : field,
      ),
    });
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    expect((screen.getByLabelText("Numbers only") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Existing custom rule: Use at least 6 characters/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove input mask" }));
    expect(screen.queryByRole("button", { name: "Remove input mask" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/tables/things/object",
        "PUT",
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({ name: "title", mask: null }),
          ]),
        }),
      ),
    );
  });

  it("creates a required email as non-null VARCHAR(255) without an Allow NULL control", async () => {
    mockApi();
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(screen.queryByText("Allow NULL (empty values)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Field name"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("Control / behavior"), { target: { value: "email" } });
    expect(screen.queryByLabelText("Text length")).toBeNull();
    fireEvent.click(screen.getByLabelText("email required"));
    fireEvent.click(screen.getByRole("button", { name: "Create field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/schema/tables/things/columns",
        "POST",
        expect.objectContaining({
          name: "email",
          type: "text",
          length: 255,
          nullable: false,
        }),
      ),
    );
    expect(api).toHaveBeenCalledWith(
      "/admin/connections/1/tables/things/object",
      "PUT",
      expect.objectContaining({
        fields: expect.arrayContaining([
          expect.objectContaining({ name: "email", widget: "email", required: true }),
        ]),
      }),
    );
  });

  it("reconciles a legacy optional field with a non-null database column", async () => {
    vi.mocked(api).mockImplementation(async (url, method = "GET") => {
      if (url === "/connections/1/tables") return ["things"] as never;
      if (url.includes("/schema/tables/things"))
        return {
          ...schema,
          columns: schema.columns.map((column) =>
            column.name === "title" ? { ...column, nullable: false } : column,
          ),
        } as never;
      if (url.endsWith("/tables/things/object") && method === "GET")
        return definition as never;
      return undefined as never;
    });
    render(<ObjectEditor connections={[{ id: 1, name: "Local" } as never]} onChanged={() => {}} />);
    await screen.findByText("varchar(100)");
    fireEvent.click(screen.getByRole("button", { name: "Edit field title" }));
    fireEvent.click(screen.getByRole("button", { name: "Save field" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        "/admin/connections/1/schema/tables/things/modify-column",
        "POST",
        expect.objectContaining({ name: "title", nullable: true }),
      ),
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
