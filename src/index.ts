import { serve } from "@hono/node-server";
import { createApp } from "./http/app.js";

const port = Number(process.env.PORT ?? 4000);

serve(
  {
    fetch: createApp().fetch,
    port,
  },
  (info) => {
    console.log(`jobrador-b listening on http://localhost:${info.port}`);
  },
);
