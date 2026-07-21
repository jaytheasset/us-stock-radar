import { Info } from "lucide-react";
import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./ProxyVoteDetails.module.css";

export type ProxyProposalDetail = {
  label: string;
  note?: string;
  value: string;
};

export type ProxyProposal = {
  boardRecommendation?: string;
  category?: string;
  details: ProxyProposalDetail[];
  explanation?: string;
  id: string;
  isShareholderProposal: boolean;
  title: string;
};

export type ProxyVoteData = {
  proposals: ProxyProposal[];
  snapshot: ListingFinancialRiskSnapshotData;
};

export function ProxyVoteSnapshot({ data }: { data: ProxyVoteData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function ProxyProposalAgenda({ data }: { data: ProxyVoteData }) {
  if (!data.proposals.length) return null;

  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <h2>Proposal Agenda</h2>
        <span>
          {data.proposals.length} {data.proposals.length === 1 ? "proposal" : "proposals"}
        </span>
      </div>

      <ol className={styles.list}>
        {data.proposals.map((proposal, index) => (
          <li className={styles.proposal} key={`${proposal.id}-${proposal.title}-${index}`}>
            <div className={styles.proposalCopy}>
              <span className={styles.index} aria-hidden="true">{proposal.id || index + 1}.</span>
              <div className={styles.copyBody}>
                {proposal.category || proposal.boardRecommendation || proposal.isShareholderProposal ? (
                  <div className={styles.meta}>
                    {proposal.category ? <span>{proposal.category}</span> : null}
                    {proposal.isShareholderProposal ? <span>Shareholder proposal</span> : null}
                    {proposal.boardRecommendation ? (
                      <span>Board: {proposal.boardRecommendation}</span>
                    ) : null}
                  </div>
                ) : null}
                <h3>{proposal.title}</h3>
                {proposal.explanation ? (
                  <div className={styles.explanation}>
                    <Info aria-hidden="true" size={14} strokeWidth={2.2} />
                    <p>{proposal.explanation}</p>
                  </div>
                ) : null}
              </div>
            </div>

            {proposal.details.length ? (
              <dl className={styles.details}>
                {proposal.details.map((detail, detailIndex) => (
                  <div className={styles.detail} key={`${detail.label}-${detail.value}-${detailIndex}`}>
                    <dt>{detail.label}</dt>
                    <dd>
                      <strong>{detail.value}</strong>
                      {detail.note ? <span>{detail.note}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
