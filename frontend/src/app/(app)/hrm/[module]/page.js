import { notFound } from "next/navigation";
import MasterDataManager from "@/components/hrm/MasterDataManager";
import { masterDataModules } from "@/components/hrm/masterDataConfig";

export default async function HrmMasterDataPage({ params }) {
  const { module } = await params;
  if (!masterDataModules[module]) notFound();
  return <MasterDataManager resource={module} />;
}
