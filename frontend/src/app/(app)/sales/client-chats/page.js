import { Suspense } from "react";
import ClientChatsPage from "@/components/sales/ClientChatsPage";

export default function ClientChatsRoute() {
  return <Suspense fallback={null}><ClientChatsPage /></Suspense>;
}
