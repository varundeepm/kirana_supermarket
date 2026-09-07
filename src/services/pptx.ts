import PptxGenJS from "pptxgenjs";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../db/client.js";

const OUT_DIR = path.resolve(process.cwd(), "generated", "decks");

const THEME = {
  bg: "1A1A2E",        // dark navy background
  accent: "E94560",    // vivid red-pink accent
  text: "EAEAEA",      // near-white text
  subtext: "AAAAAA",   // muted grey subtext
  bar1: "0F3460",      // deep blue
  bar2: "E94560",      // accent
  bar3: "16213E",      // mid-navy
};

function slideHeader(slide: any, title: string, subtitle?: string) {
  slide.background = { color: THEME.bg };
  slide.addText(title, {
    x: 0.4, y: 0.2, w: 9.2, h: 0.6,
    fontSize: 22, bold: true, color: THEME.accent, fontFace: "Arial",
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.4, y: 0.85, w: 9.2, h: 0.3,
      fontSize: 10, color: THEME.subtext, fontFace: "Arial",
    });
  }
  // accent rule below header
  slide.addShape("rect", {
    x: 0.4, y: 1.1, w: 9.2, h: 0.03,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });
}

export async function generateAnalysisDeck(fromDate: Date, toDate: Date): Promise<string> {
  const bills = await prisma.bill.findMany({
    where: { status: "FINALIZED", finalizedAt: { gte: fromDate, lte: toDate } },
    include: { items: { include: { product: true } } },
  });

  const totalSales = bills.reduce((s, b) => s + b.total, 0);
  const totalCgst = bills.reduce((s, b) => s + b.cgst, 0);
  const totalSgst = bills.reduce((s, b) => s + b.sgst, 0);
  const totalTax = totalCgst + totalSgst;
  const netRevenue = totalSales - totalTax;

  const byMode: Record<string, number> = {};
  for (const b of bills) {
    const mode = b.paymentMode ?? "UNKNOWN";
    byMode[mode] = (byMode[mode] ?? 0) + b.total;
  }

  const itemQty: Record<string, number> = {};
  const itemRevenue: Record<string, number> = {};
  for (const b of bills) {
    for (const it of b.items) {
      itemQty[it.product.name] = (itemQty[it.product.name] ?? 0) + it.qty;
      itemRevenue[it.product.name] = (itemRevenue[it.product.name] ?? 0) + it.lineTotal;
    }
  }
  const topItems = Object.entries(itemQty).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topRevItems = Object.entries(itemRevenue).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const lowStock = (await prisma.product.findMany()).filter((p) => p.stockQty <= p.reorderLevel);

  const dateRange = `${fromDate.toLocaleDateString("en-IN")} – ${toDate.toLocaleDateString("en-IN")}`;

  // pptxgenjs's UMD type defs don't resolve cleanly under NodeNext module
  // resolution (a known upstream quirk) — the `as any` cast is just to get
  // a constructable value; every method below still matches the real API.
  const pptx = new (PptxGenJS as any)();
  pptx.defineLayout({ name: "WIDESCREEN", width: 10, height: 5.63 });
  pptx.layout = "WIDESCREEN";
  pptx.title = `Sales Analysis — ${dateRange}`;
  pptx.author = "Kirana Ops Agent";

  // ── Slide 1 — Headline Numbers ────────────────────────────────────────────
  const s1 = pptx.addSlide();
  slideHeader(s1, "Sales Analysis", dateRange);

  const kpis = [
    { label: "Total Sales", value: `Rs.${totalSales.toFixed(2)}`, color: THEME.accent },
    { label: "Net Revenue", value: `Rs.${netRevenue.toFixed(2)}`, color: "16C79A" },
    { label: "GST Collected", value: `Rs.${totalTax.toFixed(2)}`, color: "F5A623" },
    { label: "Bills", value: String(bills.length), color: THEME.subtext },
  ];

  kpis.forEach((kpi, i) => {
    const x = 0.4 + i * 2.35;
    s1.addShape("rect", { x, y: 1.3, w: 2.2, h: 1.5, fill: { color: "0F3460" }, line: { color: "0F3460" } });
    s1.addText(kpi.value, { x, y: 1.45, w: 2.2, h: 0.6, fontSize: 18, bold: true, color: kpi.color, align: "center", fontFace: "Arial" });
    s1.addText(kpi.label, { x, y: 2.1, w: 2.2, h: 0.4, fontSize: 9, color: THEME.subtext, align: "center", fontFace: "Arial" });
  });

  // Payment split table summary
  if (Object.keys(byMode).length > 0) {
    let tableY = 3.1;
    s1.addText("Payment Breakdown", { x: 0.4, y: tableY - 0.3, w: 9.2, fontSize: 10, color: THEME.subtext, fontFace: "Arial" });
    const rows = Object.entries(byMode).map(([mode, amount]) => [
      { text: mode, options: { color: THEME.text, fontSize: 9 } },
      { text: `Rs.${amount.toFixed(2)}`, options: { color: THEME.accent, fontSize: 9, align: "right" } },
      { text: `${((amount / totalSales) * 100).toFixed(1)}%`, options: { color: THEME.subtext, fontSize: 9, align: "right" } },
    ]);
    s1.addTable(rows, {
      x: 0.4, y: tableY, w: 5, colW: [2, 1.5, 1.5],
      fill: { color: THEME.bar1 }, color: THEME.text, fontSize: 9,
      border: { type: "none" },
    });
  }

  // ── Slide 2 — Payment Mode Split (Pie) ───────────────────────────────────
  const s2 = pptx.addSlide();
  slideHeader(s2, "Cash vs UPI vs Card", "Payment mode breakdown by revenue");

  if (Object.keys(byMode).length > 0) {
    s2.addChart(
      pptx.ChartType.pie,
      [{ name: "Sales by mode", labels: Object.keys(byMode), values: Object.values(byMode) }],
      {
        x: 1.5, y: 1.2, w: 7, h: 3.8,
        showLegend: true, legendPos: "r",
        showLeaderLines: true, showPercent: true, showValue: false,
        chartColors: ["E94560", "0F3460", "16C79A", "F5A623"],
      }
    );
  } else {
    s2.addText("No bills in this period.", {
      x: 1, y: 2.5, w: 8, fontSize: 14, color: THEME.subtext, align: "center",
    });
  }

  // ── Slide 3 — Top Items by Quantity (Bar) ────────────────────────────────
  const s3 = pptx.addSlide();
  slideHeader(s3, "Top-Selling Items", "By quantity sold");

  if (topItems.length > 0) {
    s3.addChart(
      pptx.ChartType.bar,
      [{ name: "Qty sold", labels: topItems.map((i) => i[0]), values: topItems.map((i) => i[1]) }],
      {
        x: 0.4, y: 1.2, w: 9.2, h: 3.8,
        barDir: "bar",
        chartColors: ["E94560"],
        showValue: true, dataLabelFontSize: 8, dataLabelColor: THEME.text,
        showLegend: false,
        valAxisLabelColor: THEME.subtext,
        catAxisLabelColor: THEME.subtext,
      }
    );
  } else {
    s3.addText("No sales data in this period.", {
      x: 1, y: 2.5, w: 8, fontSize: 14, color: THEME.subtext, align: "center",
    });
  }

  // ── Slide 4 — GST Collected (CGST + SGST breakdown) ──────────────────────
  const s4 = pptx.addSlide();
  slideHeader(s4, "GST Collected", "CGST + SGST breakdown by period");

  // Summary boxes
  const gstKpis = [
    { label: "Total CGST", value: `Rs.${totalCgst.toFixed(2)}`, color: "F5A623" },
    { label: "Total SGST", value: `Rs.${totalSgst.toFixed(2)}`, color: "16C79A" },
    { label: "Total GST", value: `Rs.${totalTax.toFixed(2)}`, color: THEME.accent },
    { label: "Net (ex-GST)", value: `Rs.${netRevenue.toFixed(2)}`, color: THEME.text },
  ];
  gstKpis.forEach((kpi, i) => {
    const x = 0.4 + i * 2.35;
    s4.addShape("rect", { x, y: 1.3, w: 2.2, h: 1.3, fill: { color: "0F3460" }, line: { color: "0F3460" } });
    s4.addText(kpi.value, { x, y: 1.4, w: 2.2, h: 0.55, fontSize: 15, bold: true, color: kpi.color, align: "center", fontFace: "Arial" });
    s4.addText(kpi.label, { x, y: 2.0, w: 2.2, h: 0.35, fontSize: 8, color: THEME.subtext, align: "center", fontFace: "Arial" });
  });

  // GST by item revenue chart
  if (topRevItems.length > 0) {
    s4.addText("Top Items by Revenue", { x: 0.4, y: 2.8, w: 9.2, fontSize: 9, color: THEME.subtext, fontFace: "Arial" });
    s4.addChart(
      pptx.ChartType.bar,
      [{ name: "Revenue", labels: topRevItems.map((i) => i[0]), values: topRevItems.map((i) => Number(i[1].toFixed(2))) }],
      {
        x: 0.4, y: 3.05, w: 9.2, h: 2.3,
        barDir: "bar",
        chartColors: ["F5A623"],
        showValue: true, dataLabelFontSize: 7, dataLabelColor: THEME.text,
        showLegend: false,
        valAxisLabelColor: THEME.subtext,
        catAxisLabelColor: THEME.subtext,
      }
    );
  }

  // ── Slide 5 — Stock Health ────────────────────────────────────────────────
  const s5 = pptx.addSlide();
  slideHeader(s5, "Stock Health", "Items at or below reorder level");

  const rows: any[][] = [
    [
      { text: "Product", options: { bold: true, color: THEME.text, fontSize: 9, fill: { color: "0F3460" } } },
      { text: "In Stock", options: { bold: true, color: THEME.text, fontSize: 9, align: "center", fill: { color: "0F3460" } } },
      { text: "Reorder At", options: { bold: true, color: THEME.text, fontSize: 9, align: "center", fill: { color: "0F3460" } } },
      { text: "Status", options: { bold: true, color: THEME.text, fontSize: 9, align: "center", fill: { color: "0F3460" } } },
    ],
  ];

  if (lowStock.length === 0) {
    rows.push([
      { text: "✅ All products above reorder level", options: { colspan: 4, color: "16C79A", fontSize: 9, align: "center" } },
      { text: "" }, { text: "" }, { text: "" },
    ]);
  } else {
    for (const p of lowStock) {
      const isOut = p.stockQty <= 0;
      rows.push([
        { text: p.name, options: { color: THEME.text, fontSize: 8.5 } },
        { text: `${p.stockQty} ${p.unit}`, options: { color: isOut ? THEME.accent : "F5A623", fontSize: 8.5, align: "center" } },
        { text: `${p.reorderLevel} ${p.unit}`, options: { color: THEME.subtext, fontSize: 8.5, align: "center" } },
        { text: isOut ? "OUT OF STOCK" : "LOW", options: { color: isOut ? THEME.accent : "F5A623", fontSize: 8.5, bold: true, align: "center" } },
      ]);
    }
  }

  s5.addTable(rows, {
    x: 0.4, y: 1.25, w: 9.2,
    colW: [3.8, 1.8, 1.8, 1.8],
    fill: { color: THEME.bar3 },
    color: THEME.text,
    fontSize: 9,
    border: { pt: 0.5, color: "333366" },
    rowH: 0.38,
  });

  if (lowStock.length > 0) {
    s5.addText(`⚠ ${lowStock.length} item(s) need restocking`, {
      x: 0.4, y: 5.1, w: 9.2, fontSize: 9, color: "F5A623", fontFace: "Arial",
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `analysis-${Date.now()}.pptx`);
  await pptx.writeFile({ fileName: filePath });
  return filePath;
}
