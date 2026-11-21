export function displayName(raw: string): {
  title: string;
  detail: string | null;
} {
  const name = raw.replace(/\s+/g, " ").trim();
  const separator = name.indexOf(" - ");
  let title = name;
  let detail: string | null = null;
  if (separator > 0 && separator + 3 < name.length) {
    title = name.slice(0, separator).trim();
    detail = name.slice(separator + 3).trim();
  }
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (detail && normalize(detail) === normalize(title)) detail = null;
  const letters = title.replace(/[^\p{L}]/gu, "");
  if (
    letters.length >= 4 &&
    letters === letters.toUpperCase() &&
    letters !== letters.toLowerCase()
  )
    title = title
      .toLowerCase()
      .replace(
        /\p{L}[\p{L}\p{M}'’]*/gu,
        (word) => word.charAt(0).toUpperCase() + word.slice(1),
      );
  return { title, detail };
}
