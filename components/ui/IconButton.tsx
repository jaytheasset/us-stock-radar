import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import styles from "@/components/ui/IconButton.module.css";

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children" | "type"
> & {
  "aria-label": string;
  children: ReactNode;
  indicator?: boolean;
  type?: "button" | "submit" | "reset";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      "aria-label": ariaLabel,
      children,
      className,
      indicator = false,
      type = "button",
      ...buttonProps
    },
    ref,
  ) {
    const classes = [
      styles.button,
      indicator ? styles.indicator : undefined,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        {...buttonProps}
        aria-label={ariaLabel}
        className={classes}
        ref={ref}
        type={type}
      >
        {children}
      </button>
    );
  },
);
