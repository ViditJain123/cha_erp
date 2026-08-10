import 'server-only';

/**
 * Re-export of the service-role client, behind `server-only` so an accidental
 * import from a client component fails the build instead of shipping the key
 * that bypasses every RLS policy to a browser.
 *
 * Anything reached through here is unprotected: scope `company_id` by hand, or
 * use `serviceForCompany()`.
 */
export { serviceClient, serviceForCompany } from '@checklist/db/service';
