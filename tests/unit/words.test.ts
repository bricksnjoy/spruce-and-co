import { describe, expect, it } from "vitest";
import { amountInWords, wholeInWords } from "@/lib/words";

describe("amounts in words", () => {
  it("writes whole numbers", () => {
    expect(wholeInWords(0n)).toBe("Zero");
    expect(wholeInWords(15n)).toBe("Fifteen");
    expect(wholeInWords(210792n)).toBe("Two Hundred Ten Thousand Seven Hundred Ninety Two");
    expect(wholeInWords(1_000_005n)).toBe("One Million Five");
  });
  it("writes the grand total as the invoice prints it", () => {
    expect(amountInWords(21079269n)).toBe("Two Hundred Ten Thousand Seven Hundred Ninety Two Rufiyaa Sixty Nine Laari");
    expect(amountInWords(1585980n)).toBe("Fifteen Thousand Eight Hundred Fifty Nine Rufiyaa Eighty Laari");
    expect(amountInWords(50000n)).toBe("Five Hundred Rufiyaa");
    expect(amountInWords(1250n, "USD")).toBe("Twelve Dollars Fifty Cents");
  });
});
