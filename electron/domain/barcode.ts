const AIM_PREFIX = /^\](?:C[012]|E[012]|d[12]|Q[34]|A[012])/i;

export function barcodeCandidates(value: string): string[] {
  const clean = value.replace(/[\r\n\t]/g, "").trim().replace(AIM_PREFIX, "");
  if (!clean) return [];

  const candidates = new Set<string>();
  const gtin = clean.match(/(?:^|\u001d)01(\d{14})(?=\u001d|$)/)?.[1];
  if (gtin) candidates.add(gtin);
  candidates.add(clean.replace(/\u001d/g, ""));
  return [...candidates];
}

export function canonicalGtin(value: string): string | null {
  return /^\d+$/.test(value) && [8, 12, 13, 14].includes(value.length)
    ? value.padStart(14, "0")
    : null;
}

export function barcodeMatches(left: string, right: string): boolean {
  const rightGtin = canonicalGtin(right);
  return barcodeCandidates(left).some((candidate) =>
    candidate.toLowerCase() === right.toLowerCase() ||
    Boolean(rightGtin && canonicalGtin(candidate) === rightGtin),
  );
}

export function barcodeSearchTerms(value: string): string[] {
  const terms = new Set<string>();
  for (const candidate of barcodeCandidates(value)) {
    terms.add(candidate);
    const gtin = canonicalGtin(candidate);
    if (!gtin) continue;
    for (const length of [13, 12, 8]) {
      const shortened = gtin.slice(14 - length);
      if (canonicalGtin(shortened) === gtin) terms.add(shortened);
    }
  }
  return [...terms];
}
