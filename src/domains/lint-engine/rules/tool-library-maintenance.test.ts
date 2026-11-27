import { describe, expect, it } from "vitest";
import { styleCreatorName } from "./tool-library-maintenance";

describe("creator annotation tools", () => {
  it("adds annotations idempotently and removes them independently", () => {
    const styled = styleCreatorName("Ada", "Lovelace", "both");
    expect(styled).toEqual({ firstName: "<b>Ada</b>", lastName: "<b>Lovelace</b>*" });
    expect(styleCreatorName(styled.firstName, styled.lastName, "both")).toEqual(styled);
    expect(styleCreatorName(styled.firstName, styled.lastName, "removeBold")).toEqual({ firstName: "Ada", lastName: "Lovelace*" });
    expect(styleCreatorName(styled.firstName, styled.lastName, "removeAll")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });
  it("does not create an empty bold first name for a single-field creator", () => {
    expect(styleCreatorName("", "Research Group", "both")).toEqual({ firstName: "", lastName: "<b>Research Group</b>*" });
  });
});
