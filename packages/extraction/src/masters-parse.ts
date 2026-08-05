import { z } from 'zod';
import { MODELS, structuredPdfCall, structuredTextCall } from './openai.js';

/**
 * LLM-assisted masters maintenance:
 *  - parse a pasted CBIC/ERAM exchange-rate table into a rate table row
 *  - parse a CBIC notification PDF into proposed tariff-master rows
 * Both return proposals for a human to approve in the masters admin UI.
 */

export const ExchangeRateParseSchema = z.object({
  /** date the rates take effect (CBIC: day after notification), ISO YYYY-MM-DD */
  effectiveFrom: z.string(),
  rates: z.array(
    z.object({
      /** ISO currency code, e.g. USD */
      currency: z.string(),
      /** INR per unit for IMPORTED goods (CBIC publishes import & export columns; use import) */
      importRate: z.number(),
    }),
  ),
  notes: z.string().nullable(),
});
export type ExchangeRateParse = z.infer<typeof ExchangeRateParseSchema>;

export async function parseExchangeRateText(text: string): Promise<ExchangeRateParse> {
  return structuredTextCall({
    schema: ExchangeRateParseSchema,
    schemaName: 'exchange_rate_parse',
    system: `You parse CBIC (Indian customs) exchange-rate notifications/ERAM tables.
The table lists foreign currencies with two INR rates: one for imported goods and one for exported goods. Extract the IMPORT rate per unit.
currency MUST be the ISO 4217 code (US Dollar -> USD, Euro -> EUR, Pound Sterling -> GBP, Japanese Yen -> JPY...), never the currency name.
Rates for 100 units (e.g. JPY per 100, KRW per 100) must be divided to per-1-unit values.
effectiveFrom: the date the rates come into force (stated in the text), ISO format.`,
    userText: text,
    model: MODELS.classify,
  });
}

export const NotificationParseSchema = z.object({
  /** e.g. "045/2026" */
  notificationNumber: z.string(),
  notificationDate: z.string().nullable(),
  /** what the notification does, one line */
  summary: z.string(),
  proposals: z.array(
    z.object({
      /** 8-digit CTH when determinable; chapter/heading prefix otherwise */
      cth: z.string(),
      description: z.string(),
      /** serial number of the entry inside the notification table */
      serial: z.string().nullable(),
      bcdRate: z.number().nullable(),
      igstRate: z.number().nullable(),
      exemptionPercent: z.number().nullable(),
      conditions: z.string().nullable(),
    }),
  ),
  uncertainFields: z.array(z.string()),
});
export type NotificationParse = z.infer<typeof NotificationParseSchema>;

export async function parseNotificationPdf(fileName: string, pdf: Buffer): Promise<NotificationParse> {
  const { data } = await structuredPdfCall({
    schema: NotificationParseSchema,
    schemaName: 'notification_parse',
    system: `You parse CBIC customs notification PDFs (tariff/exemption/IGST-schedule amendments).
Extract each tariff entry the notification creates or amends as a proposal row: CTH (8-digit where given),
description, serial number in the notification table, and the effective rates. Copy values exactly; never invent CTHs.
Set bcdRate/igstRate/exemptionPercent to null unless that specific value is explicitly stated — never derive one from another.
List anything ambiguous in uncertainFields.`,
    userText: 'Extract the tariff proposals from this notification.',
    fileName,
    pdf,
  });
  return data;
}
