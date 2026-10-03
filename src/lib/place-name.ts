const LOCALITIES = new Set([
  "berlin",
  "charlottenburg",
  "wilmersdorf",
  "schoneberg",
  "kreuzberg",
  "friedrichshain",
  "prenzlauer berg",
  "mitte",
  "neukolln",
  "wedding",
  "moabit",
  "tiergarten",
  "steglitz",
  "spandau",
  "pankow",
  "lichtenberg",
  "reinickendorf",
  "tempelhof",
  "zehlendorf",
  "kopenick",
  "westend",
  "marzahn",
  "hellersdorf",
  "treptow",
]);

export function isLocality(value: string) {
  const raw = value
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return LOCALITIES.has(raw);
}

export function samePlaceName(left: string, right: string) {
  const a = compact(left);
  const b = compact(right);
  if (a.length < 4 || b.length < 4) return false;
  if (a === b) return true;
  if (isLocality(left) || isLocality(right)) return false;
  const shorter = a.length < b.length ? a : b;
  if (shorter.length < 5) return false;
  return a.includes(b) || b.includes(a);
}

function compact(value: string) {
  return value
    .toLowerCase()
    .replace(/&amp;/g, " ")
    .replace(/\b(gmbh|kg|co|ohg|ug|mbh|ag|se|stiftung|gruppe|und)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
