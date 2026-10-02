import { serve } from "@hono/node-server";
import { loadEnvFile } from "./db/env.js";
import { migrate } from "./db/migrate.js";
import { createApp } from "./http/app.js";

loadEnvFile();

const port = Number(process.env.PORT ?? 4000);

await migrate();

serve(
  {
    fetch: createApp().fetch,
    port,
  },
  (info) => {
    console.log(`jobrador-b listening on http://localhost:${info.port}`);
  },
);
