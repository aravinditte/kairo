import { describe, expect, it } from "vitest";
import { formatDuration, formatPercent, formatRate, nsFromMs, shortId } from "./index";
describe("formatting", () => {
  it("formats nanosecond durations with units", () => {
    expect(formatDuration(500)).toBe("500 ns");
    expect(formatDuration(1500)).toBe("1.5 us");
    expect(formatDuration(2_500_000)).toBe("2.50 ms");
    expect(formatDuration(250_000_000)).toBe("250.0 ms");
    expect(formatDuration(2_000_000_000)).toBe("2.00 s");
  });
  it("never renders missing data as zero", () => {
    expect(formatDuration(null)).toBe("No data");
    expect(formatDuration(undefined)).toBe("No data");
    expect(formatPercent(null)).toBe("No data");
    expect(formatRate(undefined)).toBe("No data");
  });
  it("formats percents and rates", () => {
    expect(formatPercent(0.125)).toBe("12.5%");
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatRate(1.5)).toBe("1.50 req/s");
  });
  it("converts ms filter input to ns and rejects junk", () => {
    expect(nsFromMs("2")).toBe(2_000_000);
    expect(nsFromMs("")).toBeUndefined();
    expect(nsFromMs("abc")).toBeUndefined();
    expect(nsFromMs("-5")).toBeUndefined();
  });
  it("shortens ids", () => { expect(shortId("abcdef", 3)).toBe("abc..."); expect(shortId("ab", 3)).toBe("ab"); });
});
