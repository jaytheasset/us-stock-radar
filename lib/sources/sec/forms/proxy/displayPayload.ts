export type ProxyDisplayType = "proxy_vote";

export interface ProxyDisplayPayload {
  display_type: ProxyDisplayType;
  display_version: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}
