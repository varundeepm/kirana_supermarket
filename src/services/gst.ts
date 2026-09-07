// All GST math lives here — one place, unit-tested, never re-derived in a
// prompt or duplicated in a tool handler. Intra-state assumption per the
// brief: CGST + SGST split, each = half the item's GST slab.

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface LineTax {
  lineSubtotal: number;
  lineCgst: number;
  lineSgst: number;
  lineTotal: number;
}

export function computeLineTax(qty: number, unitPrice: number, gstRatePct: number): LineTax {
  if (qty <= 0) throw new Error("qty must be positive");
  if (unitPrice < 0) throw new Error("unitPrice cannot be negative");

  const lineSubtotal = round2(qty * unitPrice);
  const gstAmount = round2((lineSubtotal * gstRatePct) / 100);
  // Split the GST amount, not the rate — avoids the two halves drifting
  // apart from independent rounding.
  const lineCgst = round2(gstAmount / 2);
  const lineSgst = round2(gstAmount - lineCgst);
  const lineTotal = round2(lineSubtotal + lineCgst + lineSgst);

  return { lineSubtotal, lineCgst, lineSgst, lineTotal };
}

export interface BillTax {
  subtotal: number;
  cgst: number;
  sgst: number;
  total: number; // rounded to the nearest rupee, retail-style
  roundOff: number;
}

export function computeBillTax(lines: LineTax[]): BillTax {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineSubtotal, 0));
  const cgst = round2(lines.reduce((s, l) => s + l.lineCgst, 0));
  const sgst = round2(lines.reduce((s, l) => s + l.lineSgst, 0));
  const exact = round2(subtotal + cgst + sgst);
  const total = Math.round(exact); // nearest rupee, as most kirana bills print
  const roundOff = round2(total - exact);
  return { subtotal, cgst, sgst, total, roundOff };
}

// GST slab lookup helper — never let the model invent a slab; it always
// comes from the product row (see inventory tools), this just validates it.
export const VALID_GST_SLABS = [0, 5, 12, 18, 28];
export function assertValidSlab(rate: number) {
  if (!VALID_GST_SLABS.includes(rate)) {
    throw new Error(`Invalid GST slab: ${rate}. Must be one of ${VALID_GST_SLABS.join(", ")}`);
  }
}
