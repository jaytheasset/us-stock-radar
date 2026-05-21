import AlertsClient from "@/app/alerts/AlertsClient";
import { getAlertSettingsViewModel, getGuestAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import { getOptionalCurrentUserId } from "@/lib/currentUser";

export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const userId = await getOptionalCurrentUserId();
  const initialSettings = userId ? await getAlertSettingsViewModel(userId) : getGuestAlertSettingsViewModel();

  return <AlertsClient initialSettings={initialSettings} />;
}
