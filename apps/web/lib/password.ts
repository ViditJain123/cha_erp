/**
 * Password rules for user-chosen passwords.
 *
 * Must stay in step with `minimum_password_length` and `password_requirements`
 * in supabase/config.toml — if these are laxer, Supabase rejects the password
 * after our own check has already passed and the user sees a confusing error.
 */
export function validatePassword(password: string, email: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 72) return 'Use at most 72 characters.';
  if (!/[a-z]/.test(password)) return 'Include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Include an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Include a digit.';
  if (password.toLowerCase() === email.toLowerCase()) return 'Do not use your email address.';
  return null;
}
