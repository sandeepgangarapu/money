// Labels only. Keep account IDs and the original filter values intact.
export function accountNickname(name: string) {
  return (
    name
      .replace(
        /\s*(?:[·•#–—-]\s*[*xX•]*\d{3,}|[([]\s*[*xX•]*\d{3,}\s*[)\]]|ending(?:\s+in)?\s+\d{3,}|[*xX•]{2,}\d{3,})\s*$/i,
        "",
      )
      .trim() || "Account"
  );
}
