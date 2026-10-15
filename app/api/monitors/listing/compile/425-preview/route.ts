import {allowedUser} from "@/lib/sec425/consumer";
import { getOptionalCurrentUserIdReadOnly } from "@/lib/currentUser";
import { compileSec425MonitorPreview } from "@/lib/monitor/sec425CandidatePreview";
import { handleSec425PreviewPost } from "./handler";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return handleSec425PreviewPost(request, { resolveUserId: getOptionalCurrentUserIdReadOnly, compile: compileSec425MonitorPreview, allowed: async(id:string)=>process.env.SEC425_MONITOR_ENABLED!=="true"||await allowedUser(id) });
}
