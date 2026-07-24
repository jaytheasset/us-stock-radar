export function resolveFilingsV2SelectedRecord<T extends { id: string }>(
  records: readonly T[],
  selectedId: string,
) {
  return records.find((record) => record.id === selectedId) ?? records[0];
}
