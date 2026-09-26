import { describe, expect, it } from "vitest";
import { COMMANDS, EXTENSION_ID, EXTENSION_NAME } from "../../../src/shared/constants";

describe("constants", () => {
  it("exports the extension id", () => {
    expect(EXTENSION_ID).toBe("codevia-cursor");
  });

  it("exports the extension display name", () => {
    expect(EXTENSION_NAME).toBe("Codevia Cursor");
  });

  it("exports stable command ids", () => {
    expect(COMMANDS.openAgent).toBe("codeviaCursor.openAgent");
    expect(COMMANDS.openSettings).toBe("codeviaCursor.openSettings");
  });
});
