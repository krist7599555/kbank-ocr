export function fp_regex(regex: RegExp, text: string): string[] {
  const a = regex.exec(text);
  if (!a) throw new Error(`regex /${regex}/ not match "${text}"`);
  return Array.from(a);
}
