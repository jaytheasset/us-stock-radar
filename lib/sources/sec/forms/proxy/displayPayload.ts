export interface ProxyDisplayPayload {
  display_type: "proxy_vote";
  display_version: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}
