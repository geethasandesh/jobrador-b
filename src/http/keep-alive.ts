import { waitUntil } from "@vercel/functions";

export function keepAlive(work: Promise<unknown>) {
  try {
    waitUntil(work);
  } catch {
    // The local server keeps the promise running after the response.
  }
}
