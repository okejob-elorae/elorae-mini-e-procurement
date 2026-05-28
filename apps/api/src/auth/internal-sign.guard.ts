import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { computeSignature } from "./internal-sign.util";

@Injectable()
export class InternalSignGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const sig = req.headers["x-internal-sign"];
    const userId = req.headers["x-user-id"];

    if (typeof sig !== "string" || typeof userId !== "string") {
      throw new UnauthorizedException("Missing internal auth headers");
    }

    const secret = this.config.get<string>("INTERNAL_API_SECRET");
    if (!secret) {
      throw new UnauthorizedException("Server misconfigured");
    }

    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const expected = computeSignature(req.method, req.path, userId, rawBody, secret);

    let sigBuf: Buffer;
    let expectedBuf: Buffer;
    try {
      sigBuf = Buffer.from(sig, "hex");
      expectedBuf = Buffer.from(expected, "hex");
    } catch {
      throw new UnauthorizedException("Invalid signature encoding");
    }

    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      throw new UnauthorizedException("Invalid signature");
    }

    (req as Request & { userId: string }).userId = userId;
    return true;
  }
}
