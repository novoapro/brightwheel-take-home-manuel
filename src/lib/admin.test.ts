import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdminPasscode } from "./admin";

const TOKEN = "xtZjTAAdV4IyktQoodM969jzwj_dT7DvxL7NjtKeads";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ADMIN_PASSCODE;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_PASSCODE;
  else process.env.ADMIN_PASSCODE = saved;
});

describe("isAdminPasscode", () => {
  it("accepts an exact match for a long token", () => {
    process.env.ADMIN_PASSCODE = TOKEN;
    expect(isAdminPasscode(TOKEN)).toBe(true);
  });

  it("tolerates a trailing newline in the configured value (host dashboard / .env footgun)", () => {
    process.env.ADMIN_PASSCODE = TOKEN + "\n";
    expect(isAdminPasscode(TOKEN)).toBe(true);
  });

  it("tolerates surrounding whitespace in the provided value", () => {
    process.env.ADMIN_PASSCODE = TOKEN;
    expect(isAdminPasscode(`  ${TOKEN} `)).toBe(true);
  });

  it("rejects a wrong, empty, or missing passcode", () => {
    process.env.ADMIN_PASSCODE = TOKEN;
    expect(isAdminPasscode("nope")).toBe(false);
    expect(isAdminPasscode("")).toBe(false);
    expect(isAdminPasscode(null)).toBe(false);
    expect(isAdminPasscode(undefined)).toBe(false);
  });

  it("falls back to the local-dev default when unset", () => {
    delete process.env.ADMIN_PASSCODE;
    expect(isAdminPasscode("change-me")).toBe(true);
    expect(isAdminPasscode(TOKEN)).toBe(false);
  });
});
