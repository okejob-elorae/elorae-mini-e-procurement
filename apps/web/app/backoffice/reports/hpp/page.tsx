import { redirect } from "next/navigation";

export default function HppReportRedirectPage() {
  redirect("/backoffice/dashboard?tab=hpp");
}
