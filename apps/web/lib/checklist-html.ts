import { chaProfile } from '@checklist/core';
import type { ChecklistDraft } from '@checklist/extraction';
import type { JobRecord } from './store';

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const n2 = (v: number | undefined | null) => (v == null ? '' : v.toFixed(2));
const dt = (iso: string | undefined | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};

function dutyLine(label: string, notn: string | undefined, rate: number, amount: number): string {
  return `<tr class="duty-line">
    <td></td><td></td>
    <td class="right">${esc(label)}:</td>
    <td>${esc(notn ?? '-')}</td>
    <td class="right">${rate}%</td>
    <td class="right">${n2(amount)}</td>
  </tr>`;
}

/** Full printable checklist HTML for a reviewed job (A4, Logi-Sys layout). */
export function checklistHtml(job: JobRecord): string {
  const d = job.draft as ChecklistDraft;
  const cha = chaProfile();
  const duty = d.duty;
  const inv = d.invoice;
  const sh = d.shipment;

  const itemsHtml = d.items
    .map((it, i) => {
      const r = duty?.items[i];
      return `
      <tr class="item-head">
        <td>${it.slNo}</td>
        <td>${esc(it.ritc)}</td>
        <td colspan="4">${esc(it.description)}</td>
      </tr>
      <tr>
        <td>${it.quantity}</td>
        <td></td>
        <td class="right">${n2(it.unitPrice)}</td>
        <td>${esc(it.ritc)}</td>
        <td class="right">${it.bcdRate}%</td>
        <td class="right">${n2(r?.bcd)}</td>
      </tr>
      ${dutyLine('AIDC', it.aidcNotification, it.aidcRate, r?.aidc ?? 0)}
      ${
        it.bcdExemption
          ? dutyLine(`${it.bcdExemption.scheme ?? 'FTA'} Exemption (${esc(it.bcdExemption.notification)})`, it.bcdExemption.serial, it.bcdExemption.percent, 0)
          : ''
      }
      <tr>
        <td>${esc(it.unit)}</td>
        <td></td>
        <td class="right">${n2(r?.assessableValue)}</td>
        <td>NOEXCISE</td>
        <td class="right">0%</td>
        <td class="right">0.00</td>
      </tr>
      ${dutyLine('Social Welfare Surcharge', undefined, it.swsRate, r?.sws ?? 0)}
      ${dutyLine('IGST Duty', it.igstNotification, it.igstRate, r?.igst ?? 0)}
      ${dutyLine('GST Compensation Cess', it.compCessNotification, it.compCessRate, r?.compCess ?? 0)}
    `;
    })
    .join('');

  const containers = sh.containers.length
    ? `<div class="section-title">Container Details</div>
       <table class="grid"><tbody>${sh.containers
         .map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.number)}</td><td>${esc(c.sizeType ?? '')}</td><td>${esc(c.sealNo ?? '')}</td></tr>`)
         .join('')}</tbody></table>`
    : '';

  const batches = d.items.filter((it) => it.batch);
  const singleWindow = batches.length
    ? `<div class="section-title">SINGLE WINDOW - Production Details</div>
       <table class="grid">
         <thead><tr><th>Inv No</th><th>Item N</th><th>Batch ID</th><th>Batch Quantity</th><th>Manufacture Date</th><th>Expiry Date</th></tr></thead>
         <tbody>${batches
           .map(
             (it) => `<tr><td>1</td><td>${it.slNo}</td><td>${esc(it.batch?.batchNo ?? '')}</td><td>${it.batch?.quantity ?? ''}</td><td>${dt(it.batch?.manufactureDate)}</td><td>${dt(it.batch?.expiryDate)}</td></tr>`,
           )
           .join('')}</tbody>
       </table>`
    : '';

  const coo = d.ftaClaim
    ? `<div class="section-title">COO details for FTA benefit claimed</div>
       <table class="grid">
         <thead><tr><th>Inv Sr</th><th>Item Sr</th><th>COO No.</th><th>Date of Issue</th><th>Country of Issue</th><th>Origin Criteria</th><th>Direct Consignment</th></tr></thead>
         <tbody><tr><td>1</td><td>1</td><td>${esc(d.ftaClaim.cooNumber)}</td><td>${dt(d.ftaClaim.cooDate)}</td><td>${esc(d.ftaClaim.countryOfIssue ?? '')}</td><td>${esc(d.ftaClaim.originCriterion ?? '')}</td><td>Yes</td></tr></tbody>
       </table>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 10mm 16mm 10mm; }
  * { box-sizing: border-box; }
  body { font: 9px/1.35 Helvetica, Arial, sans-serif; color: #000; margin: 0; }
  .center { text-align: center; }
  .right { text-align: right; }
  h1 { font-size: 13px; margin: 0; }
  h2 { font-size: 10.5px; margin: 1px 0 0; font-weight: bold; }
  .stn { font-size: 8.5px; margin-top: 1px; }
  .meta { display: flex; justify-content: space-between; font-size: 8.5px; border-bottom: 1px solid #000; padding: 3px 0; }
  .cols { display: flex; gap: 12px; margin-top: 4px; }
  .col { flex: 1; }
  .kv { display: flex; margin: 1.5px 0; }
  .kv b { width: 110px; flex: none; }
  .kv span { flex: 1; }
  .section-title { text-align: center; font-weight: bold; text-decoration: underline; margin: 10px 0 4px; font-size: 9.5px; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th { border-top: 1px solid #000; border-bottom: 1px solid #000; text-align: left; padding: 2px 4px; font-size: 8.5px; }
  table.grid td { padding: 2px 4px; vertical-align: top; }
  table.items td { padding: 1.5px 4px; }
  tr.item-head td { border-top: 1px solid #777; font-weight: bold; padding-top: 4px; }
  .totals td { border-top: 1px solid #000; font-weight: bold; }
  .duty-words { border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 0; margin-top: 4px; }
  .sig { display: flex; justify-content: space-between; margin-top: 28px; }
  .decl-text { font-size: 8px; }
  .avoid-break { break-inside: avoid; }
</style></head>
<body>
  <div class="center">
    <h1>${esc(cha.name)}</h1>
    <h2>CheckList - BILL OF ENTRY FOR HOME CONSUMPTION</h2>
    <div class="stn">[Custom stn: ${esc(d.customStation.name)},${esc(d.customStation.code)}]</div>
  </div>
  <div class="meta">
    <span>Printed On&nbsp;&nbsp;${dt(new Date().toISOString())}</span>
    <span>AEO Registration No. :</span>
    <span>AEO Role :</span>
  </div>

  <div class="cols">
    <div class="col">
      <div class="kv"><b>Job No</b><span>${esc(job.jobNumber)}</span></div>
      <div class="kv"><b>BE No. / Date</b><span></span></div>
      <div class="kv"><b>CHA Details</b><span>${esc(cha.licence)}<br>${esc(cha.name)}<br>${cha.address.map(esc).join('<br>')}</span></div>
      <div class="kv"><b>Filing Status</b><span>${esc(d.filingStatus)}</span></div>
      <div class="kv"><b>IGM No</b><span>${esc(sh.igmNo ?? '')}${sh.igmDate ? ` dt. ${dt(sh.igmDate)}` : ''}${sh.inwardDate ? ` Inw dt. ${dt(sh.inwardDate)}` : ''}</span></div>
      <div class="kv"><b>Cntry Of Origin</b><span>${esc(sh.countryOfOrigin ?? '')}</span></div>
      ${sh.mawbNo ? `<div class="kv"><b>MAWB No.</b><span>${esc(sh.mawbNo)}${sh.mawbDate ? ` dt. ${dt(sh.mawbDate)}` : ''}</span></div>` : ''}
      ${sh.hawbNo ? `<div class="kv"><b>HAWB No.</b><span>${esc(sh.hawbNo)}${sh.hawbDate ? ` dt. ${dt(sh.hawbDate)}` : ''}</span></div>` : ''}
      ${sh.blNo && !sh.mawbNo ? `<div class="kv"><b>BL No.</b><span>${esc(sh.blNo)}${sh.blDate ? ` dt. ${dt(sh.blDate)}` : ''}</span></div>` : ''}
      ${!sh.mawbNo ? `<div class="kv"><b>HBL No.</b><span>${esc(sh.hblNo ?? '')}</span></div>` : ''}
      <div class="kv"><b>No Of Pkgs</b><span>${sh.packageCount ?? ''} ${esc(sh.packageUnit ?? '')}</span></div>
      <div class="kv"><b>Marks &amp; Nos</b><span>${esc(sh.marksAndNos ?? '')}</span></div>
      <div class="kv"><b>Invoice Detail</b><span>Invoice 1 / 1</span></div>
      <div class="kv"><b>Inv No &amp; Date</b><span>${esc(inv.invoiceNumber)} dt. ${dt(inv.invoiceDate)}</span></div>
      <div class="kv"><b>Invoice Value</b><span>${n2(inv.invoiceValue)} ${esc(inv.currency)} &nbsp;&nbsp;<b>TOI</b> ${esc(inv.termsOfInvoice)}</span></div>
      ${inv.insurance && inv.insurance.kind === 'amount' ? `<div class="kv"><b>Insurance</b><span>${n2(inv.insurance.value.amount)} ${esc(inv.insurance.value.currency)}</span></div>` : ''}
      ${inv.miscCharges ? `<div class="kv"><b>Misc. Charges</b><span>${n2(inv.miscCharges.amount)} ${esc(inv.miscCharges.currency)}</span></div>` : ''}
      <div class="kv"><b>Exchange Rate</b><span>1 ${esc(inv.currency)} = ${d.invoiceMeta.exchangeRate.rate.toFixed(4)} INR</span></div>
    </div>
    <div class="col">
      <div class="kv"><b>Party Ref</b><span></span></div>
      <div class="kv"><b>Importer Detail</b><span>${esc(d.importer.iec ?? '')} &nbsp; GSTIN: ${esc(d.importer.gstin ?? '')}<br>
        M/S. ${esc(d.importer.name)}<br>
        Branch SNo: ${esc(d.importer.branchSno ?? '')} PAN: ${esc(d.importer.pan ?? '')}<br>
        ${d.importer.addressLines.map(esc).join('<br>')}</span></div>
      <div class="kv"><b>AD Code</b><span>${esc(d.importer.adCode ?? '')}</span></div>
      <div class="kv"><b>Port Of Loading</b><span>${esc(sh.portOfLoading ?? '')}</span></div>
      <div class="kv"><b>Cons. Country</b><span>${esc(sh.consCountry ?? '')}</span></div>
      <div class="kv"><b>Gross Weight</b><span>${sh.grossWeightKg != null ? `${sh.grossWeightKg.toFixed(3)} KGS` : ''}</span></div>
      <div class="kv"><b>Payment Method</b><span>${esc(d.invoiceMeta.paymentMethod)}</span></div>
      <div class="kv"><b>Nature Of Transaction</b><span>${esc(d.invoiceMeta.natureOfTransaction)}</span></div>
      <div class="kv"><b>Terms of Payment</b><span>${esc(d.invoiceMeta.termsOfPayment ?? 'OTHERS (OTHERS)')}</span></div>
      <div class="kv"><b>Supplier Name</b><span>${esc(d.supplier.name)}</span></div>
      <div class="kv"><b>Supplier Addr</b><span>${d.supplier.addressLines.map(esc).join('<br>')}${d.supplier.country ? `<br>${esc(d.supplier.country)}` : ''}</span></div>
      <div class="kv"><b>Supplier Country</b><span>${esc(d.supplier.country ?? '')}</span></div>
      <div class="kv"><b>Green Channel</b><span>No &nbsp;&nbsp; <b>Related</b> ${d.invoiceMeta.relatedParty ? 'Yes' : 'No'}</span></div>
      <div class="kv"><b>Section 48</b><span>No &nbsp;&nbsp; <b>First Check</b> No</span></div>
      <div class="kv"><b>Kachha B/E</b><span>No &nbsp;&nbsp; <b>Under SVB</b> No</span></div>
      <div class="kv"><b>Under Provisional Assessment</b><span>No</span></div>
    </div>
  </div>

  <div class="section-title">ITEM DETAILS</div>
  <table class="grid items">
    <thead>
      <tr><th>Sl No / Qty / Unit</th><th>RITC</th><th>Description / Unit Price / Assessable Value</th><th>CTH / CETH</th><th>Cus. Duty Rate</th><th>BCD Amt(Rs)</th></tr>
    </thead>
    <tbody>
      ${itemsHtml}
      <tr class="totals"><td colspan="2"></td><td class="right">${n2(duty?.totalAssessableValue)}</td><td><b>BE Gross Total</b></td><td></td>
        <td class="right">${duty ? n2(duty.totals.bcd + duty.totals.aidc + duty.totals.healthCess + duty.totals.sws + duty.totals.igst + duty.totals.compCess) : ''}</td></tr>
    </tbody>
  </table>
  <div class="duty-words"><b>Duty Payable</b><br>${esc(duty?.dutyPayableInWords ?? '')}</div>

  ${containers}

  <div class="section-title">GSTIN Details</div>
  <table class="grid">
    <thead><tr><th>Regn No</th><th>Regn Type</th><th>State Code/Name</th><th>IGST Ass.Val</th><th>IGST Amt</th><th>GST Cess Amt</th></tr></thead>
    <tbody><tr>
      <td>${esc(d.importer.gstin ?? '')}</td><td>GSTIN</td>
      <td>${esc(d.importer.gstStateCode ?? '')} - ${esc(d.importer.gstStateName ?? '')}</td>
      <td class="right">${duty?.igstAssessableValue ?? ''}</td>
      <td class="right">${duty ? Math.round(duty.totals.igst) : ''}</td>
      <td class="right">${duty ? Math.round(duty.totals.compCess) : ''}</td>
    </tr></tbody>
  </table>

  ${coo}
  ${singleWindow}

  <div class="section-title">DUTY Details</div>
  <table class="grid">
    <tbody>
      <tr><td>Basic Custom Duty</td><td class="right">${n2(duty?.totals.bcd)}</td><td>Custom (CVD)</td><td class="right">0.00</td><td>AIDC (Custom)</td><td class="right">${n2(duty?.totals.aidc)}</td></tr>
      <tr><td>Social Welfare Surcharge</td><td class="right">${n2(duty?.totals.sws)}</td><td>Antidumping Duty</td><td class="right">0.00</td><td>Safeguard Duty</td><td class="right">0.00</td></tr>
      <tr><td>IGST Duty</td><td class="right">${n2(duty?.totals.igst)}</td><td>Health Cess</td><td class="right">${n2(duty?.totals.healthCess)}</td><td>Other Additional Duty</td><td class="right">0.00</td></tr>
      <tr><td>GST Compensation Cess</td><td class="right">${n2(duty?.totals.compCess)}</td><td colspan="4"></td></tr>
    </tbody>
  </table>

  <div class="section-title">MANUFACTURER NAME</div>
  <table class="grid">
    <thead><tr><th>Inv No</th><th>Item No</th><th>Name</th><th>Address</th></tr></thead>
    <tbody>${d.items
      .map((it) => `<tr><td>1</td><td>${it.slNo}</td><td>${esc(it.manufacturerName ?? d.supplier.name)}</td><td>${esc(it.manufacturerAddress ?? d.supplier.addressLines.join(', '))}</td></tr>`)
      .join('')}</tbody>
  </table>

  <div class="section-title">SUPPORTING DOCUMENTS</div>
  <table class="grid">
    <thead><tr><th>Sr</th><th>Document</th><th>Type</th></tr></thead>
    <tbody>${d.supportingDocs
      .map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.fileName)}</td><td>${esc(s.docType.replace(/_/g, ' '))}</td></tr>`)
      .join('')}</tbody>
  </table>

  <div class="section-title">DECLARATIONS DETAILS</div>
  <table class="grid decl-text">
    <thead><tr><th style="width:60px">Decl Code</th><th>Declaration Text</th></tr></thead>
    <tbody>${d.declarations.map((dec) => `<tr class="avoid-break"><td>${esc(dec.code)}</td><td>${esc(dec.text)}</td></tr>`).join('')}</tbody>
  </table>

  <div class="avoid-break">
    <p><b>DECLARATION</b><br>1. I/We certify that the above entries are correct.</p>
    <div class="sig">
      <div><b>CHA</b><br>${esc(cha.name)}<br><br><br><b>Signature</b></div>
      <div><b>Importer</b><br>${esc(d.importer.name)}<br><br><br><b>Signature</b></div>
    </div>
  </div>
</body></html>`;
}
