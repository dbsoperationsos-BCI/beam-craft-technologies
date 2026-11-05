import Button from "./Button";

const sizes = {
  xxs: "h-6 w-6 text-sm",
  xs: "h-7 w-7 text-sm",
  sm: "h-8 w-8 text-base",
  md: "h-10 w-10 text-lg",
  lg: "h-14 w-14 text-2xl",
};

const shapes = { rounded: "rounded-md", circle: "rounded-full" };

// `title` is not defaulted to `label`: that would draw the browser's own tooltip under the
// cursor, which this module does not use. `aria-label` names the control for a screen reader
// and renders nothing. A caller that genuinely wants the tooltip still passes `title` itself.
export default function IconButton({ children, label, ariaLabel, size = "md", shape = "rounded", className = "", variant = "ghost", type = "button", ...props }) {
  return <Button type={type} variant={variant} size="none" aria-label={ariaLabel || label} className={`shrink-0 px-0 py-0 leading-none ${sizes[size] || sizes.md} ${shapes[shape] || shapes.rounded} ${className}`} {...props}>{children}</Button>;
}
