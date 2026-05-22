export type JubelioLoginResponse = {
  token?: string;
  error?: string;
  message?: string;
};

export type JubelioTokenStatus = {
  hasToken: boolean;
  updatedAt: string | null;
  expiresAt: string | null;
  expiresInSeconds: number | null;
};

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
