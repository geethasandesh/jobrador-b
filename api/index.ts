import { handle } from "@hono/node-server/vercel";
import { createApp } from "../src/http/app.js";

export default handle(createApp());
