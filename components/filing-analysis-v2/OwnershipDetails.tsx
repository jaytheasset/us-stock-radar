import {
  ListingFinancialRiskSnapshot,
  type ListingFinancialRiskSnapshotData,
} from "./ListingFinancialRiskSnapshot";
import styles from "./OwnershipDetails.module.css";

export type OwnershipDetailRow = {
  label: string;
  note?: string;
  value: string;
};

export type OwnershipTransaction = {
  code: string;
  date?: string;
  holdingsAfter?: string;
  plan10b5?: boolean;
  price?: string;
  security: string;
  shares: string;
  type: string;
  value?: string;
};

export type OwnershipData = {
  amendmentDetails?: OwnershipDetailRow[];
  details?: OwnershipDetailRow[];
  mode: "form4_transaction" | "form144_proposed_sale";
  snapshot: ListingFinancialRiskSnapshotData;
  transactions?: OwnershipTransaction[];
};

export function OwnershipSnapshot({ data }: { data: OwnershipData }) {
  return <ListingFinancialRiskSnapshot snapshot={data.snapshot} />;
}

export function OwnershipDetails({ data }: { data: OwnershipData }) {
  const transactions = (data.transactions || []).filter(
    (transaction) => transaction.security && transaction.shares,
  );
  const details = cleanRows(data.details);
  const amendmentDetails = cleanRows(data.amendmentDetails);
  const transactionColumns = {
    date: transactions.some((transaction) => transaction.date),
    holdingsAfter: transactions.some((transaction) => transaction.holdingsAfter),
    price: transactions.some((transaction) => transaction.price),
    value: transactions.some((transaction) => transaction.value),
  };

  return (
    <div className={styles.stack}>
      {data.mode === "form4_transaction" && transactions.length ? (
        <section className={styles.panel}>
          <div className={styles.heading}>
            <h2>Reported Transactions</h2>
            <span>{transactions.length} {transactions.length === 1 ? "transaction" : "transactions"}</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {transactionColumns.date ? <th>Date</th> : null}
                  <th>Type</th>
                  <th>Security</th>
                  <th>Shares</th>
                  {transactionColumns.price ? <th>Price</th> : null}
                  {transactionColumns.value ? <th>Value</th> : null}
                  {transactionColumns.holdingsAfter ? <th>Holdings After</th> : null}
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction, index) => (
                  <tr key={`${transaction.code}-${transaction.security}-${index}`}>
                    {transactionColumns.date ? <td data-label="Date">{transaction.date}</td> : null}
                    <td data-label="Type">
                      <strong>{transaction.type}</strong>
                      <span className={styles.code}>{transaction.code}</span>
                      {transaction.plan10b5 ? <span className={styles.plan}>10b5-1 plan</span> : null}
                    </td>
                    <td data-label="Security">{transaction.security}</td>
                    <td data-label="Shares">{transaction.shares}</td>
                    {transactionColumns.price ? <td data-label="Price">{transaction.price}</td> : null}
                    {transactionColumns.value ? <td data-label="Value">{transaction.value}</td> : null}
                    {transactionColumns.holdingsAfter ? (
                      <td data-label="Holdings After">{transaction.holdingsAfter}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.mode === "form144_proposed_sale" && details.length ? (
        <OwnershipRows title="Proposed Sale Details" rows={details} />
      ) : null}

      {amendmentDetails.length ? (
        <OwnershipRows title="Amendment Details" rows={amendmentDetails} />
      ) : null}
    </div>
  );
}

function OwnershipRows({
  rows,
  title,
}: {
  rows: OwnershipDetailRow[];
  title: string;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.heading}>
        <h2>{title}</h2>
        <span>Key terms</span>
      </div>
      <dl className={styles.rows}>
        {rows.map((row, index) => (
          <div key={`${row.label}-${row.value}-${index}`}>
            <dt>{row.label}</dt>
            <dd>
              <strong>{row.value}</strong>
              {row.note ? <span>{row.note}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function cleanRows(rows: OwnershipDetailRow[] | undefined) {
  return (rows || [])
    .map((row) => ({
      label: row.label.trim(),
      note: row.note?.trim(),
      value: row.value.trim(),
    }))
    .filter((row) => row.label && row.value);
}
