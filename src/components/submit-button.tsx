"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";

export function SubmitButton({
  children,
  pendingText,
  ...props
}: ComponentProps<"button"> & { pendingText?: string }) {
  const { pending } = useFormStatus();

  return (
    <button {...props} type="submit" disabled={pending} aria-disabled={pending}>
      {pending ? (pendingText ?? "Enviando...") : children}
    </button>
  );
}
