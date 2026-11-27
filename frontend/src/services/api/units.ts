const KIB_PER_MIB = 1024;
const KIB_PER_GIB = KIB_PER_MIB * 1024;
const KIB_PER_TIB = KIB_PER_GIB * 1024;

const BINARY_UNITS = [
  { unit: "TiB", kib: KIB_PER_TIB },
  { unit: "GiB", kib: KIB_PER_GIB },
  { unit: "MiB", kib: KIB_PER_MIB },
];

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, "");
}

export function formatKibToBinaryUnit(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === "number"
    ? value
    : Number(value.match(/[\d.]+/)?.[0]);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  const selectedUnit =
    BINARY_UNITS.find(({ kib }) => numericValue >= kib) ??
    BINARY_UNITS[BINARY_UNITS.length - 1];
  const unitValue = numericValue / selectedUnit.kib;

  if (unitValue < 1) {
    return `< 1 ${selectedUnit.unit}`;
  }

  return `${trimTrailingZero(unitValue.toFixed(1))} ${selectedUnit.unit}`;
}
