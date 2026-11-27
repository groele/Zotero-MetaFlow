import { describe, expect, it } from "vitest";
import {
  removeLeadingZeros,
} from "./no-extra-zeros";

describe("removeLeadingZeros", () => {
  it("should remove leading zeros from simple numbers", () => {
    expect(removeLeadingZeros("0012")).toBe("12");
    expect(removeLeadingZeros("0005")).toBe("5");
  });

  it("should not change numbers without leading zeros", () => {
    expect(removeLeadingZeros("123")).toBe("123");
    expect(removeLeadingZeros("9")).toBe("9");
  });

  it("should handle page ranges", () => {
    expect(removeLeadingZeros("0-20")).toBe("0-20");
    expect(removeLeadingZeros("0012-0020")).toBe("12-20");
    expect(removeLeadingZeros("0005-0010")).toBe("5-10");
    expect(removeLeadingZeros("0005,0010")).toBe("5,10");
  });

  it("preserves valid ranges and does not infer a replacement for zero", () => {
    for (const value of ["10-12", "20-25", "100-110", "0-5", "S10-S20", "10-20, 30-40"])
      expect(removeLeadingZeros(value)).toBe(value);
    expect(removeLeadingZeros("0010-0020")).toBe("10-20");
    expect(removeLeadingZeros(removeLeadingZeros("0010-0020"))).toBe("10-20");
  });

  it("should handle mixed text and numbers", () => {
    expect(removeLeadingZeros("Vol. 0012")).toBe("Vol. 12");
    expect(removeLeadingZeros("p.0007")).toBe("p.7");
  });
});
