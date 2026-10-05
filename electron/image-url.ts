import { isIP } from "node:net";

function isPublicHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;

  if (isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number);
    return first !== 0 && first !== 10 && first !== 127 && first !== 169 && !(first === 172 && second >= 16 && second <= 31) && !(first === 192 && second === 168);
  }
  if (isIP(host) === 6) {
    return host !== "::1" && !host.startsWith("fc") && !host.startsWith("fd") && !host.startsWith("fe80:");
  }
  return true;
}

/** Resolve catalog image URLs without allowing local-network fetches from an external host. */
export function resolveProductImageUrl(value: string, assetBase: string) {
  if (!value || !assetBase) return null;
  try {
    const backend = new URL(assetBase);
    const url = new URL(value, backend);
    const isBackend = url.origin === backend.origin;

    if (isBackend) {
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (!url.pathname.startsWith("/uploads/") && !url.pathname.startsWith("/api/uploads/")) return null;
      return url;
    }

    // External catalog imagery must be public HTTPS. Its MIME type and size are
    // still verified before it is written to the offline cache.
    if (url.protocol !== "https:" || url.username || url.password || !isPublicHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}
