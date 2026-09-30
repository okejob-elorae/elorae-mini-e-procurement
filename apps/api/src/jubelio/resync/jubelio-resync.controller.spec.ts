import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { InternalSignGuard } from "../../auth/internal-sign.guard";
import { IS_PUBLIC_KEY } from "../../auth/public.decorator";
import { JubelioResyncController } from "./jubelio-resync.controller";

/**
 * The resync trigger seeds Jubelio fetches and re-drives the salesorder ingest, so it must stay
 * on the signed web → api channel. Nothing on the controller guards it: the protection is the
 * GLOBAL `InternalSignGuard` (`APP_GUARD` in `auth.module.ts`) plus the absence of `@Public()`
 * here. These pin that pairing, so adding `@Public()` to the route or the class fails a spec
 * instead of silently opening it.
 */
describe("JubelioResyncController access", () => {
  const handler = JubelioResyncController.prototype.resync;

  function contextWithoutSignature(): ExecutionContext {
    const req = {
      method: "POST",
      path: "/jubelio/salesorders/resync",
      headers: {},
      rawBody: Buffer.from(JSON.stringify({ salesorderNos: ["SO-1"] }), "utf8"),
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => JubelioResyncController,
    } as unknown as ExecutionContext;
  }

  it("is not marked @Public on the handler or the class", () => {
    const reflector = new Reflector();
    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, JubelioResyncController]);
    expect(isPublic).toBeFalsy();
  });

  it("is refused by the global guard without the internal signature headers", () => {
    const config = { get: () => "resync-test-secret" } as unknown as ConfigService;
    const guard = new InternalSignGuard(new Reflector(), config);
    expect(() => guard.canActivate(contextWithoutSignature())).toThrow(UnauthorizedException);
  });
});
