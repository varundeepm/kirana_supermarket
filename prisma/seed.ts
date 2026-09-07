/**
 * Seed the kirana catalog with the 7 named SKUs from the brief, plus two
 * loose-item staples. Run with:
 *   npx prisma db seed
 *
 * HSN codes and GST slabs per the Indian GST schedule (as of 2024):
 *   - Atta/flour/salt: HSN 1101/2501, 0%
 *   - Edible oil: HSN 1512, 5%
 *   - Butter/dairy fat: HSN 0405, 12%
 *   - Noodles/pasta, biscuits: HSN 1902/1905, 18%
 *   - Detergent/surfactant: HSN 3402, 18%
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SKUs = [
  {
    name: "Aashirvaad Atta 5kg",
    brand: "ITC",
    sku: "ATTA-AASH-5KG",
    hsnCode: "1101",
    gstRate: 0,
    unit: "packet",
    isLoose: false,
    costPrice: 220,
    sellPrice: 260,
    reorderLevel: 5,
    initialStockQty: 20,
  },
  {
    name: "Tata Salt 1kg",
    brand: "Tata",
    sku: "SALT-TATA-1KG",
    hsnCode: "2501",
    gstRate: 0,
    unit: "packet",
    isLoose: false,
    costPrice: 18,
    sellPrice: 22,
    reorderLevel: 10,
    initialStockQty: 30,
  },
  {
    name: "Amul Butter 100g",
    brand: "Amul",
    sku: "BUTR-AMUL-100G",
    hsnCode: "0405",
    gstRate: 12,
    unit: "packet",
    isLoose: false,
    costPrice: 48,
    sellPrice: 57,
    reorderLevel: 8,
    initialStockQty: 15,
  },
  {
    name: "Fortune Sunflower Oil 1L",
    brand: "Adani Wilmar",
    sku: "OIL-FORT-1L",
    hsnCode: "1512",
    gstRate: 5,
    unit: "l",
    isLoose: false,
    costPrice: 140,
    sellPrice: 160,
    reorderLevel: 5,
    initialStockQty: 12,
  },
  {
    name: "Maggi 70g",
    brand: "Nestle",
    sku: "MGGI-NSTL-70G",
    hsnCode: "1902",
    gstRate: 18,
    unit: "packet",
    isLoose: false,
    costPrice: 12,
    sellPrice: 15,
    reorderLevel: 15,
    initialStockQty: 50,
  },
  {
    name: "Parle-G 100g",
    brand: "Parle",
    sku: "BSCT-PRLG-100G",
    hsnCode: "1905",
    gstRate: 18,
    unit: "packet",
    isLoose: false,
    costPrice: 8,
    sellPrice: 10,
    reorderLevel: 20,
    initialStockQty: 60,
  },
  {
    name: "Surf Excel 500g",
    brand: "HUL",
    sku: "DETG-SXCL-500G",
    hsnCode: "3402",
    gstRate: 18,
    unit: "packet",
    isLoose: false,
    costPrice: 95,
    sellPrice: 115,
    reorderLevel: 5,
    initialStockQty: 20,
  },
  // ---- Loose items ----
  {
    name: "Sugar (loose)",
    brand: null,
    sku: "SUGR-LOOS",
    hsnCode: "1701",
    gstRate: 5,
    unit: "kg",
    isLoose: true,
    costPrice: 42,
    sellPrice: 48,
    reorderLevel: 5,
    initialStockQty: 25,
  },
  {
    name: "Toor Dal (loose)",
    brand: null,
    sku: "DAL-TOOR-LOOS",
    hsnCode: "0713",
    gstRate: 0,
    unit: "kg",
    isLoose: true,
    costPrice: 100,
    sellPrice: 115,
    reorderLevel: 5,
    initialStockQty: 20,
  },
];

async function main() {
  console.log("Seeding catalog...");
  let created = 0;
  let skipped = 0;

  for (const sku of SKUs) {
    const existing = await prisma.product.findUnique({ where: { sku: sku.sku } });
    if (existing) {
      console.log(`  skip  ${sku.name} (already in DB)`);
      skipped++;
      continue;
    }
    await prisma.product.create({
      data: {
        name: sku.name,
        brand: sku.brand,
        sku: sku.sku,
        hsnCode: sku.hsnCode,
        gstRate: sku.gstRate,
        unit: sku.unit as any,
        isLoose: sku.isLoose,
        costPrice: sku.costPrice,
        sellPrice: sku.sellPrice,
        reorderLevel: sku.reorderLevel,
        stockQty: sku.initialStockQty,
      },
    });
    console.log(`  seeded ${sku.name}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
