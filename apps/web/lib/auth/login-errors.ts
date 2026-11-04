import { CredentialsSignin } from "next-auth";

/*
 * Sign-in failures the login form must tell apart.
 *
 * Before these, every failure reached the form as "email or password invalid"
 * — including the evening the local database was down, when the password was
 * right and retyping it could never help. `code` travels to the client in the
 * `signIn()` response (see `lib/auth/login-message.ts`).
 */

/** The user store could not be read (database down, tunnel wedged). */
export class ServerUnavailableSignin extends CredentialsSignin {
  code = "unavailable";
}

/** This email hit the attempt limit in `lib/auth/login-throttle.ts`. */
export class TooManyAttemptsSignin extends CredentialsSignin {
  code = "rate_limited";
}
