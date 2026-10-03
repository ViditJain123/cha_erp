import type { BcdExemptionEntry, CompCessEntry, EximSchemeEntry, FtaConcession, IgstScheduleEntry } from '@checklist/core';
import { logisysNotn } from '@checklist/core';

/**
 * Every filable value a tool handed the model during one run.
 *
 * The rule the agent lives under is "the masters name, the model picks": a
 * CTH, a notification or a serial in its final answer is only ever one it was
 * shown by a tool in this run. The tools register what they return here, and
 * `validate` in apply.ts refuses anything else — a number remembered from
 * training, a serial read off a web page, a code typed from the invoice. What
 * is refused is not lost; it becomes a flag with the model's evidence, for a
 * person.
 *
 * `filable` on a BCD entry is narrower than "registered": an entry the tool
 * returned but marked as lapsed, stale, pre-effective or List-based is shown
 * so the model can reason about it, and still cannot be filed.
 */
export interface RegisteredBcd {
  entry: BcdExemptionEntry;
  subEntry?: string;
  filable: boolean;
  why?: string;
}

export interface RegisteredExim {
  code: string;
  entry: EximSchemeEntry;
}

export class CandidateRegistry {
  readonly cth = new Set<string>();
  readonly bcd = new Map<string, RegisteredBcd>();
  readonly igst = new Map<string, { notification: string; entry: IgstScheduleEntry }>();
  readonly cess = new Map<string, { notification: string; entry: CompCessEntry }>();
  readonly exim = new Map<string, RegisteredExim>();
  readonly fta = new Map<string, FtaConcession>();
  readonly notifications = new Set<string>();

  static bcdKey(notification: string, serial: string, subEntry?: string | null): string {
    return `${logisysNotn(notification) ?? notification}|${serial}${subEntry ? `|${subEntry}` : ''}`;
  }

  static igstKey(notification: string, serial: string): string {
    return `${logisysNotn(notification) ?? notification}|${serial}`;
  }

  static cessKey(notification: string, serial: string): string {
    return `${logisysNotn(notification) ?? notification}|${serial}`;
  }

  static ftaKey(agreement: string, notification: string, serial: string): string {
    return `${agreement}|${logisysNotn(notification) ?? notification}|${serial}`;
  }

  addCth(cth: string | undefined | null): void {
    const code = (cth ?? '').replace(/\D/g, '');
    if (code.length === 8) this.cth.add(code);
  }

  addBcd(notification: string, r: RegisteredBcd): void {
    this.bcd.set(CandidateRegistry.bcdKey(notification, r.entry.serial, r.subEntry), r);
  }

  addIgst(notification: string, entry: IgstScheduleEntry): void {
    this.igst.set(CandidateRegistry.igstKey(notification, `${entry.schedule}${entry.serial}`), { notification, entry });
  }

  addCess(notification: string, entry: CompCessEntry): void {
    this.cess.set(CandidateRegistry.cessKey(notification, entry.serial), { notification, entry });
  }

  addExim(code: string, entry: EximSchemeEntry): void {
    this.exim.set(entry.notification, { code, entry });
  }

  addFta(c: FtaConcession): void {
    this.fta.set(CandidateRegistry.ftaKey(c.agreement.key, c.notification, c.serial), c);
  }

  addNotification(number: string | undefined | null): void {
    const key = logisysNotn(number) ?? number?.trim();
    if (key) this.notifications.add(key);
  }

  /** Keys only — enough for an audit to see what was admissible. */
  digest(): Record<string, string[]> {
    return {
      cth: [...this.cth],
      bcd: [...this.bcd.entries()].map(([k, v]) => (v.filable ? k : `${k} (not filable: ${v.why ?? '?'})`)),
      igst: [...this.igst.keys()],
      cess: [...this.cess.keys()],
      exim: [...this.exim.keys()],
      fta: [...this.fta.keys()],
      notifications: [...this.notifications],
    };
  }
}
