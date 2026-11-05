import ClientAuthLayout from "@/components/client/ClientAuthLayout";
import ClientLoginForm from "@/components/client/ClientLoginForm";

export const metadata = { title: "Client sign in" };

export default function ClientLoginPage() {
  return <ClientAuthLayout><ClientLoginForm /></ClientAuthLayout>;
}
