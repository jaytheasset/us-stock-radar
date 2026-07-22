import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";
import styles from "@/components/ui/FilterOption.module.css";

export type FilterOptionProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-pressed" | "children" | "type"
> & {
  label: string;
  selected: boolean;
  type?: "button" | "submit" | "reset";
};

export const FilterOption = forwardRef<HTMLButtonElement, FilterOptionProps>(
  function FilterOption(
    {
      className,
      label,
      selected,
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
      </button>
    );
  },
);
