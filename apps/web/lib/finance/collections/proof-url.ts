import { urlFromKey } from "@/lib/r2";
import { isR2KeyInFolder } from "@/lib/r2-key";

/**
 * The proof URL a submission may show or hand on to a payment, derived from its stored key. The
 * stored `proofUrl` is never read: a row written by a raw caller before the key binding existed
 * can hold an arbitrary URL, so only a key sitting directly in the receivable's own folder counts.
 */
export function collectionProofUrl(row: { receivableId: string; proofR2Key: string | null }): string | null {
  return row.proofR2Key && isR2KeyInFolder(row.proofR2Key, `collection-proofs/${row.receivableId}`)
    ? urlFromKey(row.proofR2Key)
    : null;
}
