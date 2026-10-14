import { describe, expect, it } from "vitest";
import { buttonState, canConfigure } from "../../scripts/core/access.mjs";
import { SUPPORTED_TYPES } from "../../scripts/core/types.mjs";

describe("canConfigure (C1)", () => {
  const table = [
    // isGM, isOwner, allowPlayers, expected
    [true, false, false, true],
    [true, true, true, true],
    [false, true, true, true],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, false]
  ];
  it.each(table)("isGM=%s isOwner=%s allowPlayers=%s -> %s", (isGM, isOwner, allowPlayers, expected) => {
    expect(canConfigure({ isGM, isOwner, allowPlayers })).toBe(expected);
  });
});

describe("buttonState (C1, C2)", () => {
  it.each(SUPPORTED_TYPES)("enabled for %s when allowed", (type) => {
    expect(buttonState({ type, canConfigure: true })).toBe("enabled");
  });
  it.each(["spell", "feat", "class", "background", "race", "subclass"])("hidden for the unsupported type %s", (type) => {
    expect(buttonState({ type, canConfigure: true })).toBe("hidden");
  });
  it("is hidden when the user may not configure", () => {
    expect(buttonState({ type: "weapon", canConfigure: false })).toBe("hidden");
  });
  it("is disabled in a locked compendium", () => {
    expect(buttonState({ type: "weapon", canConfigure: true, packLocked: true })).toBe("disabled");
  });
  it("a locked compendium does not reveal the button to a user without access", () => {
    expect(buttonState({ type: "weapon", canConfigure: false, packLocked: true })).toBe("hidden");
  });
});
