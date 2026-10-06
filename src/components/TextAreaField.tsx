import type { TextareaHTMLAttributes } from "react";

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  wrapperClassName?: string;
};

/** A consistent labelled multiline field for forms and dialogs. */
export function TextAreaField({
  label,
  hint,
  wrapperClassName = "",
  className = "",
  ...props
}: TextAreaFieldProps) {
  return (
    <label className={`field-textarea ${wrapperClassName}`.trim()}>
      <span className="field-label">{label}</span>
      <textarea className={`text-area ${className}`.trim()} {...props} />
      {hint ? <small className="field-help">{hint}</small> : null}
    </label>
  );
}
