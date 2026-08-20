import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getFieldReturnById } from "@/lib/field-sales/retur/queries";
import { FieldReturnDetailClient } from "./FieldReturnDetailClient";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function FieldReturnDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect("/login");

  const { id } = await params;
  const fieldReturn = await getFieldReturnById(id);
  if (!fieldReturn) notFound();

  return <FieldReturnDetailClient fieldReturn={fieldReturn} />;
}
