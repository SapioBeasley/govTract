export type ProcurementSourceAuthority = "authoritative" | "aggregator" | "unknown";

export function normalizeProcurementSourceAuthority(
  value: string | null | undefined,
): ProcurementSourceAuthority {
  if (value === "authoritative" || value === "aggregator") return value;
  return "unknown";
}
