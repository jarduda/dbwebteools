import type { InputMask } from "./api";

const characterSetLabels: Record<InputMask["characterSet"], string> = {
  letters: "letters",
  digits: "numbers",
  alphanumeric: "letters and numbers",
};

export function maskTip(mask: InputMask): string {
  const required = mask.requiredCharacters || "";
  return `Use at least ${mask.minimumLength} characters. Allowed: ${characterSetLabels[mask.characterSet]}${required ? " plus the required characters." : "."}${required ? ` Include each of these characters: ${[...required].map((character) => `'${character}'`).join(" ")}.` : ""}`;
}

export function maskConfigurationError(mask: InputMask): string | null {
  if (!["letters", "digits", "alphanumeric"].includes(mask.characterSet))
    return "Choose a supported character set.";
  if (!Number.isInteger(mask.minimumLength) || mask.minimumLength < 1 || mask.minimumLength > 4000)
    return "Minimum length must be between 1 and 4000.";
  const required = mask.requiredCharacters || "";
  if (required.length > 16)
    return "Use at most 16 required characters.";
  if ([...required].some((character) => character < "!" || character > "~" || /[A-Za-z0-9]/.test(character)))
    return "Required characters must be punctuation without spaces.";
  if (new Set(required).size !== required.length)
    return "Required characters must not be repeated.";
  if (mask.minimumLength < required.length)
    return "Minimum length must allow all required characters.";
  return null;
}

export function maskValueError(mask: InputMask, value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return maskTip(mask);
  const required = mask.requiredCharacters || "";
  const base =
    mask.characterSet === "letters"
      ? /^[A-Za-z]$/
      : mask.characterSet === "digits"
        ? /^[0-9]$/
        : /^[A-Za-z0-9]$/;
  if (
    value.length < mask.minimumLength ||
    [...value].some((character) => !base.test(character) && !required.includes(character)) ||
    [...required].some((character) => !value.includes(character))
  )
    return maskTip(mask);
  return null;
}
