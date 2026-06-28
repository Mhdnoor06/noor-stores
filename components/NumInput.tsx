"use client";

import { InputHTMLAttributes, useEffect, useRef, useState } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number;
  onValueChange: (n: number) => void;
};

// A number input bound to a numeric value that can still be CLEARED to empty
// and retyped — unlike a raw `value={number}` field, which snaps back to 0 the
// instant you delete a digit and traps you. While the field is empty the parent
// sees 0 (so totals stay correct), but the box shows blank so the user can key a
// fresh amount. On blur an empty box settles to 0.
export default function NumInput({ value, onValueChange, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState<string>(value ? String(value) : "");
  const focused = useRef(false);

  // Mirror external changes (e.g. a unit switch re-prices the line) only while
  // the user isn't actively editing, so we never yank the field out from under them.
  useEffect(() => {
    if (!focused.current) setText(value ? String(value) : "");
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        const num = parseFloat(v);
        onValueChange(isNaN(num) ? 0 : num);
      }}
      onBlur={(e) => {
        focused.current = false;
        const num = parseFloat(text);
        const final = isNaN(num) ? 0 : num;
        setText(final ? String(final) : "");
        onValueChange(final);
        onBlur?.(e);
      }}
    />
  );
}
