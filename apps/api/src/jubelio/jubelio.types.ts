import { ApiProperty } from "@nestjs/swagger";

export type JubelioLoginResponse = {
  token?: string;
  error?: string;
  message?: string;
};

export class JubelioTokenStatus {
  @ApiProperty({ description: "Whether a Jubelio session token is currently cached." })
  hasToken!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "ISO-8601 timestamp of the last token refresh, or null if none.",
  })
  updatedAt!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "ISO-8601 timestamp at which the cached token expires.",
  })
  expiresAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Seconds remaining until token expiry, or null if no token.",
  })
  expiresInSeconds!: number | null;
}

export class JubelioError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "JubelioError";
  }
}

export class JubelioConfigError extends JubelioError {
  constructor(missing: string) {
    super(`Jubelio configuration missing: ${missing}`);
    this.name = "JubelioConfigError";
  }
}

export class JubelioAuthError extends JubelioError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "JubelioAuthError";
  }
}
