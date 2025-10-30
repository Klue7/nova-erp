export function toDate(value: Date | string) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  return new Date(value);
}

export function subDays(date: Date | string, amount: number) {
  const result = toDate(date);
  result.setDate(result.getDate() - amount);
  return result;
}

export function formatISODate(
  date: Date | string,
  { representation = "date" }: { representation?: "date" | "complete" } = {},
) {
  const d = toDate(date);
  if (representation === "date") {
    return d.toISOString().slice(0, 10);
  }
  return d.toISOString();
}

export function parseISODate(value: string) {
  return new Date(value);
}

export function isAfterDate(a: Date | string, b: Date | string) {
  return toDate(a).getTime() > toDate(b).getTime();
}

export function isBeforeDate(a: Date | string, b: Date | string) {
  return toDate(a).getTime() < toDate(b).getTime();
}

export function isEqualDate(a: Date | string, b: Date | string) {
  return toDate(a).getTime() === toDate(b).getTime();
}

export function formatDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(undefined, options).format(toDate(date));
}
