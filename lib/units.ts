import { invalid } from "@/lib/errors";

/** Converts a decimal string like "12.5" to token base units, rejecting excess precision. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  if (frac.length > decimals) throw invalid(`Amount has more than ${decimals} decimal places`);
  const units = BigInt(whole + frac.padEnd(decimals, "0"));
  if (units <= 0n) throw invalid("Amount must be greater than zero");
  return units.toString();
}

export function formatUnits(units: string, decimals: number): string {
  const s = units.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
