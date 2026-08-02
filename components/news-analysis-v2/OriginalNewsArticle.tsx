import styles from "./OriginalNewsArticle.module.css";

export function OriginalNewsArticle({ html }: { html: string }) {
  if (!html) return null;
  return (
    <div
      className={`${styles.content} news-original-article`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
