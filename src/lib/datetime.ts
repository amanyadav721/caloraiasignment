export function parseUtcTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const normalizedValue = value.trim().replace(" ", "T");

  if (hasExplicitTimeZone(normalizedValue)) {
    const explicitDate = new Date(normalizedValue);
    return Number.isNaN(explicitDate.getTime()) ? null : explicitDate;
  }

  const match = normalizedValue.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?)?$/,
  );

  if (!match) {
    const fallbackDate = new Date(`${normalizedValue}Z`);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }

  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0"] = match;
  const milliseconds = Number(fraction.slice(0, 3).padEnd(3, "0"));

  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      milliseconds,
    ),
  );
}

function hasExplicitTimeZone(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
}
