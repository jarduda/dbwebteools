import { describe, expect, it } from "vitest";
import {
  maskConfigurationError,
  maskMaximumLength,
  maskMinimumLength,
  maskValueError,
} from "./field-mask";

describe("exact field masks", () => {
  it("matches required and optional typed positions", () => {
    const mask = { pattern: "AA-##?" };
    expect(maskMinimumLength(mask)).toBe(4);
    expect(maskMaximumLength(mask)).toBe(5);
    expect(maskValueError(mask, "AB-1")).toBeNull();
    expect(maskValueError(mask, "AB-12")).toBeNull();
    expect(maskValueError(mask, "AB-")).not.toBeNull();
    expect(maskValueError(mask, "A1-12")).not.toBeNull();
  });

  it("allows optional literals without greedy position loss", () => {
    const mask = { pattern: "##-?#" };
    expect(maskValueError(mask, "123")).toBeNull();
    expect(maskValueError(mask, "12-3")).toBeNull();
    expect(maskValueError(mask, "12--3")).not.toBeNull();
  });

  it("supports escaped reserved symbols", () => {
    const mask = { pattern: "\\#-###" };
    expect(maskValueError(mask, "#-123")).toBeNull();
    expect(maskValueError(mask, "1-123")).not.toBeNull();
  });

  it("rejects malformed and non-useful patterns", () => {
    expect(maskConfigurationError({ pattern: "" })).not.toBeNull();
    expect(
      maskConfigurationError({ pattern: "###", characterSet: "digits" }),
    ).toContain("cannot be combined");
    expect(maskConfigurationError({ pattern: "##??" })).not.toBeNull();
    expect(maskConfigurationError({ pattern: "###\\" })).not.toBeNull();
    expect(maskConfigurationError({ pattern: "\\q#" })).not.toBeNull();
    expect(maskConfigurationError({ pattern: "---" })).not.toBeNull();
    expect(maskConfigurationError({ pattern: "#".repeat(257) })).toContain(
      "at most 256 positions",
    );
  });
});
