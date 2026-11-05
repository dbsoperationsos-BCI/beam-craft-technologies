import { apiRequest } from "@/services/api/client";

export function login(credentials) {
  return apiRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

/**
 * Asks for a reset link.
 *
 * The server answers the same way whether or not the address has an account, so there is nothing
 * here to branch on - the caller shows what it says and no more.
 */
export function requestPasswordReset(email) {
  return apiRequest("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Asks for a six-digit code on the mobile number an employee record holds.
 *
 * The server answers the same way whether or not the number belongs to an account, for the reason
 * the emailed route does - so there is nothing here to branch on either.
 */
export function requestPasswordResetOtp(mobile) {
  return apiRequest("/api/auth/forgot-password/otp", {
    method: "POST",
    body: JSON.stringify({ mobile }),
  });
}

/**
 * Exchanges a correct code for the reset token the emailed link would have carried.
 *
 * From there it is `resetPassword` below, unchanged: one place sets a password, whichever way
 * somebody proved who they were.
 */
export function verifyPasswordResetOtp({ mobile, otp }) {
  return apiRequest("/api/auth/forgot-password/otp/verify", {
    method: "POST",
    body: JSON.stringify({ mobile, otp }),
  });
}

/** Sets a new password against the token from the emailed link. */
export function resetPassword({ token, password }) {
  return apiRequest("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}
