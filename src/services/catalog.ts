import { prisma } from "../db/client.js";

export interface ProductMatch {
  id: string;
  name: string;
  brand: string | null;
  unit: string;
  isLoose: boolean;
  sellPrice: number;
  costPrice: number;
  gstRate: number;
  stockQty: number;
  reorderLevel: number;
}

// Deliberately returns *candidates*, not a single best guess. Grounding
// means the agent must pick from what's actually in the DB — if "atta"
// matches both "Aashirvaad Atta 5kg" and loose atta, the tool hands back
// both and the model asks the owner which one, per the brief's
// disambiguation requirement.
export async function findProducts(query: string, limit = 5): Promise<ProductMatch[]> {
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { sku: { contains: query } },
        { brand: { contains: query } },
      ],
    },
    take: limit,
    orderBy: { name: "asc" },
  });
  return rows;
}

export async function getProductById(id: string) {
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) throw new Error(`No product with id ${id}`);
  return p;
}
