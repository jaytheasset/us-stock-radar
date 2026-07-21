import {
  FinancingDilutionDetails,
  FinancingDilutionInstrumentDetails,
  FinancingDilutionOfferingDetails,
  FinancingDilutionSnapshot,
  type FinancingDilutionCapitalStructureData,
} from "./FinancingDilutionCapitalStructure";

export type OfferingRegistrationData = FinancingDilutionCapitalStructureData;

export function OfferingRegistrationSnapshot({
  data,
}: {
  data: OfferingRegistrationData;
}) {
  return <FinancingDilutionSnapshot data={data} />;
}

export function OfferingRegistrationDetails({
  data,
}: {
  data: OfferingRegistrationData;
}) {
  return <FinancingDilutionDetails data={data} />;
}

export function OfferingRegistrationInstrumentDetails({
  data,
}: {
  data: OfferingRegistrationData;
}) {
  return <FinancingDilutionInstrumentDetails data={data} />;
}

export function OfferingRegistrationOfferingDetails({
  data,
}: {
  data: OfferingRegistrationData;
}) {
  return <FinancingDilutionOfferingDetails data={data} />;
}
