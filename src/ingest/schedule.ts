import { runIngest } from "./run.js";

const hours = [7, 19];

function berlinParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function nextRun(from = new Date()) {
  const now = berlinParts(from);
  const upcoming = hours.find((hour) => hour > now.hour || (hour === now.hour && now.minute === 0 && now.second < 5));
  const hour = upcoming ?? hours[0] ?? 7;
  const dayShift = upcoming == null ? 1 : 0;
  const stamp = Date.UTC(now.year, now.month - 1, now.day + dayShift, hour - 1, 0, 0);
  const berlinOffset = berlinParts(new Date(stamp)).hour - hour;
  return new Date(stamp - berlinOffset * 60 * 60 * 1000);
}

export function startIngestSchedule() {
  const arm = () => {
    const when = nextRun();
    const wait = Math.max(1_000, when.getTime() - Date.now());
    console.log(`job ingest scheduled for ${when.toISOString()}`);
    setTimeout(() => {
      void runIngest()
        .then((report) => console.log("job ingest finished", report))
        .catch((error: unknown) => console.error("job ingest failed", error))
        .finally(arm);
    }, wait);
  };
  arm();
}
