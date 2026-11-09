const MARKS: Record<string, string> = {
  ā: 'a', á: 'a', ǎ: 'a', à: 'a',
  ē: 'e', é: 'e', ě: 'e', è: 'e',
  ī: 'i', í: 'i', ǐ: 'i', ì: 'i',
  ō: 'o', ó: 'o', ǒ: 'o', ò: 'o',
  ū: 'u', ú: 'u', ǔ: 'u', ù: 'u',
  ǖ: 'ü', ǘ: 'ü', ǚ: 'ü', ǜ: 'ü',
  ń: 'n', ň: 'n', ǹ: 'n', ḿ: 'm',
}

export function stripTones(s: string): string {
  let out = ''
  for (const ch of s.normalize('NFC')) out += MARKS[ch] ?? MARKS[ch.toLowerCase()] ?? ch
  return out
}

/** Toneless, lowercase, letters only, ü -> v. "Xuésheng" / "xue2 sheng5" / "lǜ" -> "xuesheng" / "xuesheng" / "lv". */
export function pinyinKey(s: string): string {
  return stripTones(s)
    .toLowerCase()
    .replace(/u:/g, 'v')
    .replace(/ü/g, 'v')
    .replace(/[^a-z]/g, '')
}

export function looksLikePinyin(q: string): boolean {
  return /^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü:'\s1-5]+$/.test(q.trim())
}
