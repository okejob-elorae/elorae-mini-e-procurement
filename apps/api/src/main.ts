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

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  mountSwagger(app);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  log.log(`@elorae/api listening on http://localhost:${port}`);
  if (process.env.SWAGGER_USER && process.env.SWAGGER_PASS) {
    log.log(`docs at http://localhost:${port}/docs (basic auth)`);
  }
}

void bootstrap();
