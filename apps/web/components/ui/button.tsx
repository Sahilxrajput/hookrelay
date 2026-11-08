import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes } from "react";
export function Button({
  className,
  variant = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
}) {
  return <button className={cn("button", variant, className)} {...props} />;
}
