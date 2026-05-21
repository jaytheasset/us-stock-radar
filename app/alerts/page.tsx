import AlertsClient from "@/app/alerts/AlertsClient";
import { getAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import { getCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const initialSettings = await getAlertSettingsViewModel(await getCurrentUserId());

  return <AlertsClient initialSettings={initialSettings} />;
}
