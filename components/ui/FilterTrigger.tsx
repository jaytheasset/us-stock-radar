import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "@/components/ui/FilterTrigger.module.css";

export type FilterTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-expanded" | "children" | "type"
> & {
  active?: boolean;
  expanded?: boolean;
  label: string;
  trailingIcon?: ReactNode;
  type?: "button" | "submit" | "reset";
  value?: string;
  variant?: "split" | "compact";
};

export const FilterTrigger = forwardRef<HTMLButtonElement, FilterTriggerProps>(
  function FilterTrigger(
    {
      active = false,
      className,
      expanded,
      label,
      trailingIcon,
      type = "button",
      value,
      variant = "split",
      ...buttonProps
    },
    ref,
  ) {
    const classes = [
      styles.button,
      styles[variant],
      active ? styles.active : undefined,
      value !== undefined ? styles.withValue : undefined,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        {...buttonProps}
        aria-expanded={expanded}
        className={classes}
        ref={ref}
        type={type}
      >
        <span className={styles.label}>{label}</span>
        {value !== undefined ? <b className={styles.value}>{value}</b> : null}
        {trailingIcon}
      </button>
    );
  },
);
