import { redirect } from "next/navigation";
import {
  getPackerOrderDetail,
  listOrdersWithoutPackingVideo,
} from "@/lib/packer/queries";
import { RecordWizardClient } from "./RecordWizardClient";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ orderId?: string; mode?: string }>;

export default async function PackerRecordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const mode = sp.mode === "edit" ? "edit" : "new";
  const orderId = sp.orderId?.trim() || null;

  if (mode === "edit" && !orderId) {
    redirect("/packer");
  }

  const orderOptions =
    mode === "new"
      ? await listOrdersWithoutPackingVideo(150)
      : [];

  let initialDetail = null;
  if (orderId) {
    const detail = await getPackerOrderDetail(orderId);
    if (!detail) redirect("/packer");
    if (mode === "edit" && !detail.hasPackingVideo) {
      redirect(`/packer/record?orderId=${orderId}`);
    }
    if (mode === "new" && detail.hasPackingVideo) {
      redirect(`/packer/record?orderId=${orderId}&mode=edit`);
    }
    initialDetail = {
      ...detail,
      transactionDate: detail.transactionDate.toISOString(),
    };
  }

  return (
    <RecordWizardClient
      mode={mode}
      initialOrderId={orderId}
      orderOptions={orderOptions.map((o) => ({
        ...o,
        transactionDate: o.transactionDate.toISOString(),
      }))
      }
      initialDetail={initialDetail}
    />
  );
}
