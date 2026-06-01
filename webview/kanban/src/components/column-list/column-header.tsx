/**
 * Column header — vendored chrome, display-only (the methodology columns are
 * fixed, so no rename / delete / colour). Title + a count pill.
 */
import styles from "./column-list.module.scss";

export function ColumnHeader({
  title,
  count,
}: {
  title: string;
  count: number;
}): JSX.Element {
  return (
    <header className={styles.header}>
      <span>{title}</span>
      <span className={styles.count}>{count}</span>
    </header>
  );
}
