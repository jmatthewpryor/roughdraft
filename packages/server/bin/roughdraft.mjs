#!/usr/bin/env node

import { createServer } from "../dist/index.js";
import path from "node:path";
import { findAvailablePort } from "../dist/ports.js";

const preferredPort = parseInt(process.env.PORT || "3000", 10);
const port = await findAvailablePort(preferredPort);
const projectDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

if (port !== preferredPort) {
  console.log(`Preferred port ${preferredPort} is busy, using ${port} instead.`);
}

createServer(port, projectDir);
