import { existsSync } from "node:fs";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";

const envCandidates = [
  join(__dirname, "../.env"),
  join(__dirname, "../../../.env"),
  join(__dirname, "../../web/.env"),
];
for (const p of envCandidates) {
  if (existsSync(p)) {
    loadEnv({ path: p });
    break;
  }
}

import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`@elorae/api listening on http://localhost:${port}`);
}

void bootstrap();
