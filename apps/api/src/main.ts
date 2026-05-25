import "./bootstrap-env";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import basicAuth from "express-basic-auth";
import { AppModule } from "./app.module";

const log = new Logger("Bootstrap");

function mountSwagger(app: NestExpressApplication) {
  const user = process.env.SWAGGER_USER;
  const pass = process.env.SWAGGER_PASS;
  if (!user || !pass) {
    log.warn("SWAGGER_USER / SWAGGER_PASS not set — /docs is disabled");
    return;
  }

  app.use(
    ["/docs", "/docs-json", "/docs-yaml"],
    basicAuth({
      users: { [user]: pass },
      challenge: true,
      realm: "elorae-api-docs",
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("@elorae/api")
    .setDescription("Elorae Jubelio integration service")
    .setVersion("0.1.0")
    .addTag("health", "Liveness probe")
    .addTag("jubelio", "Jubelio integration (token, gateway, sync)")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);
}

function parseCorsOrigins(): string[] | true {
  const raw = process.env.CORS_ORIGINS;
  if (!raw || raw.trim() === "") return [];
  if (raw.trim() === "*") return true;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  const origins = parseCorsOrigins();
  if (origins === true || (Array.isArray(origins) && origins.length > 0)) {
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
    log.log(`CORS enabled for: ${origins === true ? "*" : origins.join(", ")}`);
  } else {
    log.warn("CORS_ORIGINS not set — cross-origin requests will be blocked");
  }

  mountSwagger(app);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
  log.log(`@elorae/api listening on http://localhost:${port}`);
  if (process.env.SWAGGER_USER && process.env.SWAGGER_PASS) {
    log.log(`docs at http://localhost:${port}/docs (basic auth)`);
  }
}

void bootstrap();
