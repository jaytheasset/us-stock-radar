import {
  CALENDAR_EVENT_TYPES,
  eventTypeCategories,
  eventTypeLabels,
  type CalendarEventType,
  type PolicyCalendarEventType,
  type PolicySubcategory,
} from "./model.ts";

export const policyEventTypeSubcategories = {
  "fomc-decision": "monetary-policy",
  "fomc-minutes": "monetary-policy",
  "fed-chair-testimony": "monetary-policy",
  "treasury-borrowing-estimate": "treasury",
  "treasury-refunding": "treasury",
  "treasury-auction-10y": "treasury",
  "treasury-auction-30y": "treasury",
  "sec-open-meeting": "sec-regulation",
  "sec-rule-milestone": "sec-regulation",
  "trade-policy-action": "trade-policy",
  "fda-advisory-committee": "industry-regulation",
} as const satisfies Record<PolicyCalendarEventType, PolicySubcategory>;

export type CalendarEventTypeManifestEntry = {
  eventType: CalendarEventType;
  category: (typeof eventTypeCategories)[CalendarEventType];
  policySubcategory: PolicySubcategory | null;
  label: string;
  schemaVersion: 1;
};

export const calendarEventTypeManifest: readonly CalendarEventTypeManifestEntry[] =
  CALENDAR_EVENT_TYPES.map((eventType) => {
    const category = eventTypeCategories[eventType];

    return {
      eventType,
      category,
      policySubcategory:
        category === "policy"
          ? policyEventTypeSubcategories[eventType as PolicyCalendarEventType]
          : null,
      label: eventTypeLabels[eventType],
      schemaVersion: 1,
    };
  });
