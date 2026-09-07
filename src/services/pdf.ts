import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/client.js";

const OUT_DIR = path.resolve(process.cwd(), "generated", "invoices");

// PDFKit embeds the built-in Helvetica/Helvetica-Bold which covers Latin but
// not the ₹ glyph (U+20B9). We write "Rs." where ₹ falls back for safety and
// use the ₹ symbol where possible with a fallback.
const INR = "\u20B9"; // ₹

function inr(amount: number): string {
  return `${INR}${amount.toFixed(2)}`;
}

export async function generateInvoicePdf(billId: string): Promise<string> {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: { items: { include: { product: true } }, customer: true },
  });
  if (!bill) throw new Error(`No bill ${billId}`);
  if (bill.status !== "FINALIZED") throw new Error("Can only invoice a finalized bill.");

  const [shopNamePref, shopGstinPref, shopAddressPref] = await Promise.all([
    prisma.preference.findUnique({ where: { key: "shop_name" } }),
    prisma.preference.findUnique({ where: { key: "shop_gstin" } }),
    prisma.preference.findUnique({ where: { key: "shop_address" } }),
  ]);

  const shopName = shopNamePref?.value ?? process.env.SHOP_NAME ?? "Kirana Store";
  const shopGstin = shopGstinPref?.value ?? process.env.SHOP_GSTIN ?? "";
  const shopAddress = shopAddressPref?.value ?? process.env.SHOP_ADDRESS ?? "";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `invoice-${bill.id}.pdf`);

  const doc = new PDFDocument({ margin: 36, size: "A5" });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageWidth = doc.page.width - 72; // margins on both sides
  const startX = 36;

  // ── Header ────────────────────────────────────────────────────────────────
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .text(shopName, startX, 36, { width: pageWidth, align: "center" });

  if (shopAddress) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(shopAddress, startX, doc.y + 2, { width: pageWidth, align: "center" });
  }
  if (shopGstin) {
    doc
      .font("Helvetica")
      .fontSize(8)
      .text(`GSTIN: ${shopGstin}`, startX, doc.y + 2, { width: pageWidth, align: "center" });
  }

  // "TAX INVOICE" badge
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("TAX INVOICE", startX, doc.y + 6, { width: pageWidth, align: "center" });

  // Rule below header
  doc
    .moveTo(startX, doc.y + 4)
    .lineTo(startX + pageWidth, doc.y + 4)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.4);

  // ── Invoice meta ─────────────────────────────────────────────────────────
  const metaY = doc.y;
  const halfW = pageWidth / 2;
  doc.font("Helvetica").fontSize(8);

  doc.text(`Invoice No: ${bill.id}`, startX, metaY, { width: halfW });
  doc.text(
    `Date: ${bill.finalizedAt?.toLocaleString("en-IN") ?? "—"}`,
    startX + halfW,
    metaY,
    { width: halfW, align: "right" }
  );
  const nextY = doc.y + 2;
  doc.text(`Bill To: ${bill.customer?.name ?? "Walk-in customer"}`, startX, nextY, { width: halfW });
  doc.text(
    `Payment: ${bill.paymentMode ?? "—"}${bill.paymentRef ? ` (${bill.paymentRef})` : ""}`,
    startX + halfW,
    nextY,
    { width: halfW, align: "right" }
  );
  doc.moveDown(0.5);

  // Rule above table
  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + pageWidth, doc.y)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.2);

  // ── Line items table ──────────────────────────────────────────────────────
  const cols = [
    { label: "Item", w: 115 },
    { label: "HSN", w: 38 },
    { label: "Qty", w: 30 },
    { label: "Rate", w: 42 },
    { label: "GST%", w: 30 },
    { label: "CGST", w: 38 },
    { label: "SGST", w: 38 },
    { label: "Total", w: 43 },
  ];

  // Header row
  let rowY = doc.y;
  let colX = startX;
  doc.font("Helvetica-Bold").fontSize(7.5);
  for (const c of cols) {
    const align = c.label === "Item" || c.label === "HSN" ? "left" : "right";
    doc.text(c.label, colX, rowY, { width: c.w, align });
    colX += c.w;
  }
  rowY += 11;

  // Header underline
  doc.moveTo(startX, rowY).lineTo(startX + pageWidth, rowY).lineWidth(0.5).stroke();
  rowY += 3;

  // Data rows
  doc.font("Helvetica").fontSize(7.5);
  for (const item of bill.items) {
    colX = startX;
    const cells = [
      { v: item.product.name, align: "left" as const },
      { v: item.product.hsnCode, align: "left" as const },
      { v: String(item.qty), align: "right" as const },
      { v: item.unitPrice.toFixed(2), align: "right" as const },
      { v: `${item.gstRate}%`, align: "right" as const },
      { v: item.lineCgst.toFixed(2), align: "right" as const },
      { v: item.lineSgst.toFixed(2), align: "right" as const },
      { v: item.lineTotal.toFixed(2), align: "right" as const },
    ];
    cells.forEach((cell, i) => {
      doc.text(cell.v, colX, rowY, { width: cols[i].w, align: cell.align });
      colX += cols[i].w;
    });
    rowY += 13;
  }

  // Rule below items
  doc.moveTo(startX, rowY).lineTo(startX + pageWidth, rowY).lineWidth(0.5).stroke();
  rowY += 6;

  // ── Totals block ─────────────────────────────────────────────────────────
  const totalLabelW = pageWidth - 60;
  doc.font("Helvetica").fontSize(8.5);

  function totalRow(label: string, value: string, bold = false) {
    if (bold) doc.font("Helvetica-Bold");
    else doc.font("Helvetica");
    doc.text(label, startX, rowY, { width: totalLabelW, align: "right" });
    doc.text(value, startX + totalLabelW, rowY, { width: 60, align: "right" });
    rowY += 13;
  }

  totalRow("Subtotal:", inr(bill.subtotal));
  totalRow("CGST:", inr(bill.cgst));
  totalRow("SGST:", inr(bill.sgst));
  if (bill.roundOff !== 0) {
    totalRow("Round-off:", inr(bill.roundOff));
  }

  // Bold rule before grand total
  doc.moveTo(startX + totalLabelW - 20, rowY - 2).lineTo(startX + pageWidth, rowY - 2).lineWidth(0.8).stroke();
  totalRow(`TOTAL (${bill.paymentMode ?? "—"}):`, inr(bill.total), true);

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.moveDown(1);
  doc
    .moveTo(startX, doc.y)
    .lineTo(startX + pageWidth, doc.y)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor("#666666")
    .text("Thank you for shopping! Goods once sold are not returnable.", startX, doc.y, {
      width: pageWidth,
      align: "center",
    });
  doc
    .fontSize(7)
    .text("This is a computer-generated invoice and does not require a signature.", startX, doc.y + 2, {
      width: pageWidth,
      align: "center",
    });

  doc.end();
  await new Promise<void>((resolve) => stream.on("finish", () => resolve()));
  return filePath;
}
