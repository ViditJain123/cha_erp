/**
 * Application branding.
 *
 * PLACEHOLDER — the product has no name yet. Everything user-facing (page
 * titles, the app shell, every outbound email) reads from here, so renaming
 * the product is a one-line change in this file.
 */
export const APP = {
  /** Full product name. Shown in the sidebar, page titles and email subjects. */
  name: 'Acme ERP',
  /** Compact form for tight spaces (mobile header, favicon text). */
  shortName: 'ERP',
  /** One-line descriptor used in <meta name="description"> and email footers. */
  tagline: 'Customs clearance operations, end to end',
  /** Where users are told to write when something is wrong. */
  supportEmail: 'support@example.com',
  /** Accent colour, mirrored by the Tailwind classes in the app shell. */
  primaryColor: '#4f46e5',
} as const;

export type AppConfig = typeof APP;

/** Team categories a company user can belong to. `do` = Delivery Order. */
export const TEAMS = {
  scrutiny: {
    key: 'scrutiny',
    label: 'Scrutiny',
    description: 'Receives shipment documents by email and prepares checklists.',
  },
  do: {
    key: 'do',
    label: 'DO',
    description: 'Delivery Order desk. Chases the delivery order and the container deposit.',
  },
  customs: {
    key: 'customs',
    label: 'Customs',
    description: 'Gets the Bill of Entry noted, passed, paid and out of charge.',
  },
  cfs: {
    key: 'cfs',
    label: 'CFS',
    description: 'Approves or refuses the delivery days proposed at their container freight station.',
  },
  customer_support: {
    key: 'customer_support',
    label: 'Customer support',
    description: 'Tells the customer when a delivery is not going ahead.',
  },
} as const;

export type TeamKey = keyof typeof TEAMS;

/** Roles, ordered from most to least privileged within a company. */
export const ROLES = {
  platform_admin: { key: 'platform_admin', label: 'Platform admin' },
  company_owner: { key: 'company_owner', label: 'Owner' },
  company_admin: { key: 'company_admin', label: 'Admin' },
  member: { key: 'member', label: 'Member' },
} as const;

export type RoleKey = keyof typeof ROLES;

/** Roles that may invite and manage other users inside their own company. */
export const COMPANY_MANAGER_ROLES: readonly RoleKey[] = ['company_owner', 'company_admin'];
