import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "@/components/ui/FilterOption.module.css";

export type FilterOptionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "children" | "type"
> & {
  label: string;
  selected: boolean;
  selectedIndicator?: ReactNode;
  type?: "button" | "submit" | "reset";
};

export const FilterOption = forwardRef<HTMLButtonElement, FilterOptionProps>(
  function FilterOption(
    {
      className,
      label,
      selected,
      selectedIndicator,
      type = "button",
      ...buttonProps
    },
    ref,
  ) {
    const classes = [styles.button, selected ? styles.selected : undefined, className]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        {...buttonProps}
        aria-pressed={selected}
        className={classes}
        ref={ref}
        type={type}
      >
        {label}
        {selected && selectedIndicator ? (
          <span aria-hidden="true" className={styles.indicator}>
            {selectedIndicator}
          </span>
        ) : null}
      </button>
    );
  },
);
