type SeparatorProps = {
  className?: string;
};

export function Separator({ className }: SeparatorProps) {
  const classes = ["ui-separator", className].filter(Boolean).join(" ");
  return <hr className={classes} />;
}
