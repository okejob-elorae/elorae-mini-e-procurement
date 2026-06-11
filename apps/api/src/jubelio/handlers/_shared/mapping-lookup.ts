import type { JubelioProductMapping } from "@elorae/db";

export type MappingFinder = {
  jubelioProductMapping: {
    findFirst: (args: { where: { jubelioItemId: number } }) => Promise<JubelioProductMapping | null>;
  };
};

export async function resolveItemMapping(
  tx: MappingFinder,
  jubelioItemId: number,
): Promise<JubelioProductMapping | null> {
  return tx.jubelioProductMapping.findFirst({ where: { jubelioItemId } });
}
