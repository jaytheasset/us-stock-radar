"use client";

import { useRef, type KeyboardEvent } from "react";
import styles from "@/components/ui/SegmentedControl.module.css";

export type SegmentedControlItem<Value extends string> = {
  label: string;
  value: Value;
};

export type SegmentedControlProps<Value extends string> = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  items: readonly SegmentedControlItem<Value>[];
  onValueChange: (value: Value) => void;
  value: Value;
  variant?: "primary" | "compact";
};

export function SegmentedControl<Value extends string>({
  ariaLabel,
  className,
  disabled = false,
  items,
  onValueChange,
  value,
  variant = "primary",
}: SegmentedControlProps<Value>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const classes = [styles.root, styles[variant], className].filter(Boolean).join(" ");

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % items.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + items.length) % items.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }

    if (nextIndex === undefined) {
      return;
    }

    event.preventDefault();
    const nextItem = items[nextIndex];
    onValueChange(nextItem.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div aria-label={ariaLabel} aria-orientation="horizontal" className={classes} role="tablist">
      {items.map((item, index) => {
        const isSelected = item.value === value;

        return (
          <button
            aria-selected={isSelected}
            className={`${styles.item}${isSelected ? ` ${styles.selected}` : ""}`}
            disabled={disabled}
            key={item.value}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => moveSelection(event, index)}
            ref={(button) => {
              buttonRefs.current[index] = button;
            }}
            role="tab"
            tabIndex={isSelected ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
