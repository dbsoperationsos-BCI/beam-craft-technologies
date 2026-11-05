import Button from "@/components/shared/Button";

/**
 * The store's buttons: the shared Button, wearing the gallery's own colour for the main action when
 * the studio set one, and the store's larger touch size. One place, so every call to action in the
 * store reads alike.
 */
export default function StoreButton({ accent, variant = "secondary", size = "lg", className = "", style, ...props }) {
  const painted = variant === "primary" && accent ? { backgroundColor: accent, ...style } : style;
  return <Button variant={variant} size={size} className={`rounded-xl font-semibold ${className}`} style={painted} {...props} />;
}
