import {
  SEC_FORM_ROOM_MANIFEST,
  SEC_PRODUCTION_INGEST_SCHEDULE,
  normalizeSecFormType,
} from "@/lib/sources/sec/forms/common/forms";
import { SEC_FORM_FETCH_PLANS } from "@/lib/sources/sec/forms/fetchPlanRegistry";
import { SEC_FORM_WORKERS, canonicalSecFormType } from "@/lib/sources/sec/forms/formWorkerRegistry";

export type SecFormReleaseGateCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type SecFormReleaseGateRoom = {
  slug: string;
  workerKey: string;
  forms: string[];
  workerForms: string[];
  fetchForms: string[];
  checks: SecFormReleaseGateCheck[];
  ok: boolean;
};

export function buildSecFormRoutingReleaseGate() {
  const roomResults: SecFormReleaseGateRoom[] = SEC_FORM_ROOM_MANIFEST.map((room) => {
    const worker = SEC_FORM_WORKERS.find((candidate) => candidate.key === room.workerKey);
    const fetchPlan = SEC_FORM_FETCH_PLANS.find((candidate) => candidate.room === room.slug);
    const expectedForms = normalizedForms(room.forms);
    const workerForms = normalizedForms(worker?.forms || []);
    const fetchForms = normalizedForms(fetchPlan?.forms || []);
    const checks: SecFormReleaseGateCheck[] = [
      check(
        "worker_registered",
        Boolean(worker),
        worker ? `Worker ${worker.key} is registered.` : `Worker ${room.workerKey} is missing.`,
      ),
      check(
        "worker_forms_match_manifest",
        sameValues(expectedForms, workerForms),
        describeDifference(expectedForms, workerForms, "worker"),
      ),
      check(
        "fetch_plan_registered",
        Boolean(fetchPlan),
        fetchPlan ? `Fetch plan ${fetchPlan.room} is registered.` : `Fetch plan ${room.slug} is missing.`,
      ),
      check(
        "fetch_forms_match_manifest",
        sameValues(expectedForms, fetchForms),
        describeDifference(expectedForms, fetchForms, "fetch plan"),
      ),
    ];

    for (const form of room.forms) {
      const canonicalForm = canonicalSecFormType(form);
      const owners = SEC_FORM_WORKERS.filter((candidate) => candidate.matches(canonicalForm));
      const fetchOwners = SEC_FORM_FETCH_PLANS.filter((candidate) =>
        candidate.forms.some((candidateForm) => normalizeSecFormType(candidateForm) === normalizeSecFormType(form)),
      );
      checks.push(
        check(
          `worker_owner:${form}`,
          owners.length === 1 && owners[0]?.key === room.workerKey,
          owners.length
            ? `${form} worker owner(s): ${owners.map((candidate) => candidate.key).join(", ")}.`
            : `${form} has no worker owner.`,
        ),
        check(
          `fetch_owner:${form}`,
          fetchOwners.length === 1 && fetchOwners[0]?.room === room.slug,
          fetchOwners.length
            ? `${form} fetch owner(s): ${fetchOwners.map((candidate) => candidate.room).join(", ")}.`
            : `${form} has no fetch-plan owner.`,
        ),
      );
    }

    return {
      slug: room.slug,
      workerKey: room.workerKey,
      forms: [...room.forms],
      workerForms: worker ? [...worker.forms] : [],
      fetchForms: fetchPlan ? [...fetchPlan.forms] : [],
      checks,
      ok: checks.every((item) => item.ok),
    };
  });

  const manifestForms = SEC_FORM_ROOM_MANIFEST.flatMap((room) => room.forms.map((form) => normalizeSecFormType(form)));
  const scheduledRooms = SEC_PRODUCTION_INGEST_SCHEDULE.flatMap((group) => [...group.rooms]);
  const manifestRooms = SEC_FORM_ROOM_MANIFEST.map((room) => room.slug);
  const oversizedIngestGroups = SEC_PRODUCTION_INGEST_SCHEDULE.filter((group) => {
    const formCount = group.rooms.reduce(
      (total, slug) => total + (SEC_FORM_ROOM_MANIFEST.find((room) => room.slug === slug)?.forms.length || 0),
      0,
    );
    return formCount * group.countPerForm > 50;
  });
  const globalChecks = [
    check(
      "room_count",
      SEC_FORM_ROOM_MANIFEST.length === 15,
      `Expected 15 SEC form rooms; found ${SEC_FORM_ROOM_MANIFEST.length}.`,
    ),
    check(
      "worker_count",
      SEC_FORM_WORKERS.length === 15,
      `Expected 15 SEC form workers; found ${SEC_FORM_WORKERS.length}.`,
    ),
    check(
      "manifest_forms_unique",
      new Set(manifestForms).size === manifestForms.length,
      `Manifest contains ${manifestForms.length - new Set(manifestForms).size} duplicate normalized form assignments.`,
    ),
    check(
      "production_schedule_covers_all_rooms",
      sameValues([...manifestRooms].sort(), [...new Set(scheduledRooms)].sort()),
      describeDifference([...manifestRooms].sort(), [...new Set(scheduledRooms)].sort(), "production schedule"),
    ),
    check(
      "production_schedule_rooms_unique",
      new Set(scheduledRooms).size === scheduledRooms.length,
      `Production schedule contains ${scheduledRooms.length - new Set(scheduledRooms).size} duplicate room assignments.`,
    ),
    check(
      "production_schedule_respects_ingest_limit",
      oversizedIngestGroups.length === 0,
      oversizedIngestGroups.length
        ? `Groups exceed the 50-item ingest limit: ${oversizedIngestGroups.map((group) => group.id).join(", ")}.`
        : "Every production ingest group fits within the 50-item request limit.",
    ),
  ];
  const checks = [...globalChecks, ...roomResults.flatMap((room) => room.checks)];

  return {
    ok: checks.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    summary: {
      roomCount: SEC_FORM_ROOM_MANIFEST.length,
      workerCount: SEC_FORM_WORKERS.length,
      formCount: manifestForms.length,
      passedChecks: checks.filter((item) => item.ok).length,
      failedChecks: checks.filter((item) => !item.ok).length,
    },
    checks: globalChecks,
    rooms: roomResults,
    productionSchedule: SEC_PRODUCTION_INGEST_SCHEDULE,
  };
}

function check(id: string, ok: boolean, detail: string): SecFormReleaseGateCheck {
  return { id, ok, detail };
}

function normalizedForms(forms: readonly string[]) {
  return [...new Set(forms.map((form) => normalizeSecFormType(form)))].sort();
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function describeDifference(expected: readonly string[], actual: readonly string[], label: string) {
  const missing = expected.filter((form) => !actual.includes(form));
  const extra = actual.filter((form) => !expected.includes(form));
  if (!missing.length && !extra.length) return `Manifest and ${label} forms match.`;
  return [
    missing.length ? `missing: ${missing.join(", ")}` : "",
    extra.length ? `extra: ${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}
