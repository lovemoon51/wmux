const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9_]{12,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{12,}\b/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]{8,}/gi
];

export function redactSecrets(value: string): string {
  return secretPatterns.reduce((text, pattern) => text.replace(pattern, "<redacted>"), value);
}
