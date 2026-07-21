import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";

export type StrategicTransactionSnapshotData = ListingFinancialRiskSnapshotData;

type StrategicTransactionSnapshotProps = {
  snapshot: StrategicTransactionSnapshotData;
};

export function StrategicTransactionSnapshot({
  snapshot,
}: StrategicTransactionSnapshotProps) {
  return <ListingFinancialRiskSnapshot snapshot={snapshot} />;
}
