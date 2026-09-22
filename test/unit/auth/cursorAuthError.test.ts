import { describe, expect, it } from "vitest";
import { CursorAuthError } from "../../../src/auth/cursorAuthError";

describe("CursorAuthError", () => {
  it("extends Error and carries exitCode", () => {
    const error = new CursorAuthError("Token expired", 401);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Token expired");
    expect(error.exitCode).toBe(401);
    expect(error.name).toBe("CursorAuthError");
  });
});
