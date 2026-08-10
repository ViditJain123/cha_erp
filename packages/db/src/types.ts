/**
 * Convenience aliases over the generated schema.
 *
 * `database.types.ts` is generated — regenerate it with `pnpm db:types` after
 * every migration and never hand-edit it. This file is where readable names for
 * the shapes we use most live.
 */
import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types.js';

export type { Database, Json } from './database.types.js';
export type { Tables, TablesInsert, TablesUpdate } from './database.types.js';

export type AppRole = Database['public']['Enums']['app_role'];
export type TeamKind = Database['public']['Enums']['team_kind'];
export type UserStatus = Database['public']['Enums']['user_status'];
export type CompanyStatus = Database['public']['Enums']['company_status'];

export type CompanyRow = Tables<'companies'>;
export type CompanyInsert = TablesInsert<'companies'>;
export type CompanyUpdate = TablesUpdate<'companies'>;

export type ProfileRow = Tables<'profiles'>;
export type ProfileInsert = TablesInsert<'profiles'>;
export type ProfileUpdate = TablesUpdate<'profiles'>;
