import { handle } from "hono/vercel";
import { createApp } from "../src/http/app.js";

export default handle(createApp());
