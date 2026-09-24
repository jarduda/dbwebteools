// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { pageHref, parsePageRoute, recordText, RecordPageView } from "./record-pages";
import type { Column } from "./api";
import { api } from "./api";

vi.mock("./api", async (original) => {
  const actual = await original<typeof import("./api")>();
  return { ...actual, api: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const column = (name: string, key = false): Column => ({
  name,
  type: "varchar",
  nullable: false,
  primaryKey: key,
  autoIncrement: false,
  generated: false,
  default: null,
});
it("keeps hidden composite and large keys intact in bookmarkable links", () => {
  const columns = [column("id", true), column("part", true), column("name")];
  const row = {
    values: { id: "9007199254740993", part: "a/#? & Łódź", name: "Shown" },
    version: "v",
  };
  const route = parsePageRoute(pageHref(5, row, columns));
  expect(route?.id).toBe(5);
  expect(JSON.parse(route!.key)).toEqual({
    id: "9007199254740993",
    part: "a/#? & Łódź",
  });
  expect(parsePageRoute("#page/5/%invalid")).toBeNull();
});
it("uses friendly and virtual display values without exposing stored keys as labels", () => {
  const row = {
    values: { status: "a" },
    displayValues: { status: "Active" },
    joinedValues: { total: "12.34" },
    version: "v",
  };
  expect(recordText(row, column("status"))).toBe("Active");
  expect(
    recordText(row, column("total"), {
      name: "total",
      label: "Total",
      order: 0,
      section: "",
      hidden: false,
      readOnly: true,
      widget: "formula",
    }),
  ).toBe("12.34");
});

it("shows database NULL as blank while preserving zero", () => {
  for (const type of ["int", "decimal", "double", "bigint"]) {
    const c = { ...column("amount"), type, nullable: true };
    expect(recordText({ values: { amount: null }, version: "v" }, c)).toBe("");
    expect(recordText({ values: { amount: 0 }, version: "v" }, c)).toBe("0");
  }
  expect(
    recordText({ values: { text: null }, version: "v" }, column("text")),
  ).toBe("");
});

it("shows record details without layout section names", async () => {
  vi.mocked(api).mockResolvedValue({
    page: {
      id: 1,
      connectionId: 1,
      table: "customers",
      name: "Customer",
      linkColumn: "id",
      tabs: [],
    },
    record: {
      values: { id: 1, email: "person@example.com" },
      version: "v",
    },
    columns: [column("id", true), column("email")],
    fields: [
      {
        name: "id",
        label: "ID",
        section: "Identity",
        order: 0,
        hidden: false,
        readOnly: true,
        widget: "auto",
      },
      {
        name: "email",
        label: "Email",
        section: "Contact details",
        order: 1,
        hidden: false,
        readOnly: false,
        widget: "email",
      },
    ],
    canUpdate: false,
  } as never);
  render(
    <RecordPageView
      route={{ id: 1, key: JSON.stringify({ id: 1 }), trail: [] }}
      editor={() => null}
    />,
  );
  await screen.findByText("person@example.com");
  expect(screen.queryByText("Identity")).toBeNull();
  expect(screen.queryByText("Contact details")).toBeNull();
  expect(screen.getByText("Email")).toBeTruthy();
});

it("encodes the full drill-down path and rejects malformed bookmarks", () => {
  const parent = { id: 3, key: JSON.stringify({ id: "9007199254740993" }) };
  const row = { values: { id: "second/#? Łódź" }, version: "v" };
  const link = pageHref(4, row, [column("id", true)], [parent]);
  const route = parsePageRoute(link)!;
  expect(route.trail).toEqual([parent]);
  expect(route.id).toBe(4);
  expect(JSON.parse(route.key)).toEqual(row.values);
  for (const bad of [
    "#page/1/null",
    "#page/1/[]",
    "#page/0/{}",
    "#page/1/{}/bad",
  ])
    expect(parsePageRoute(bad)).toBeNull();
});
