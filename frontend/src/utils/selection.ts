export function selectionPrompt(label: string): string {
  const name = label.trim();
  const lastCharacter = name.charCodeAt(name.length - 1);
  const hasFinalConsonant = lastCharacter >= 0xac00 && lastCharacter <= 0xd7a3
    && (lastCharacter - 0xac00) % 28 !== 0;
  return `${name}${hasFinalConsonant ? "을" : "를"} 선택하세요`;
}
