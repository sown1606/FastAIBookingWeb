import { FormEvent, useRef, useState } from "react";
import { useI18n } from "../lib/i18n";

type FieldType =
  | "text"
  | "email"
  | "url"
  | "tel"
  | "password"
  | "number"
  | "datetime-local"
  | "textarea"
  | "select"
  | "checkbox-list";

interface FormDialogOption {
  value: string;
  label: string;
}

interface FormDialogField {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  helpText?: string;
  options?: FormDialogOption[];
  rows?: number;
}

interface FormDialogConfig<T extends Record<string, string>> {
  title: string;
  description?: string;
  fields: FormDialogField[];
  initialValues: T;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ActiveDialog {
  title: string;
  description?: string;
  fields: FormDialogField[];
  confirmLabel: string;
  cancelLabel: string;
}

const splitListValue = (value: string | undefined) => {
  return value?.split(",").filter(Boolean) ?? [];
};

export const toDateTimeLocalValue = (value: string | Date | null | undefined): string => {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

export const useFormDialog = () => {
  const { t } = useI18n();
  const resolverRef = useRef<((result: Record<string, string> | null) => void) | null>(null);
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const closeDialog = (result: Record<string, string> | null) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setDialog(null);
    setValues({});
  };

  const openFormDialog = <T extends Record<string, string>,>(
    config: FormDialogConfig<T>
  ): Promise<T | null> => {
    setDialog({
      title: config.title,
      description: config.description,
      fields: config.fields,
      confirmLabel: config.confirmLabel ?? t("common.save"),
      cancelLabel: config.cancelLabel ?? t("common.cancel")
    });
    setValues(config.initialValues);

    return new Promise<T | null>((resolve) => {
      resolverRef.current = (result) => resolve(result as T | null);
    });
  };

  const toggleListOption = (fieldName: string, optionValue: string, checked: boolean) => {
    setValues((prev) => {
      const selected = new Set(splitListValue(prev[fieldName]));
      if (checked) {
        selected.add(optionValue);
      } else {
        selected.delete(optionValue);
      }
      return {
        ...prev,
        [fieldName]: Array.from(selected).join(",")
      };
    });
  };

  const FormDialog = () => {
    if (!dialog) {
      return null;
    }

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      closeDialog(values);
    };

    return (
      <div className="dialog-backdrop" role="presentation">
        <form className="dialog-panel" onSubmit={onSubmit}>
          <div className="section-header">
            <div>
              <h3>{dialog.title}</h3>
              {dialog.description ? <p className="muted">{dialog.description}</p> : null}
            </div>
          </div>
          {dialog.fields.map((field) => {
            const value = values[field.name] ?? "";
            if (field.type === "textarea") {
              return (
                <label key={field.name} className="field">
                  <span>
                    {field.label}
                    {field.required ? <em>{t("common.required")}</em> : null}
                  </span>
                  <textarea
                    value={value}
                    rows={field.rows ?? 3}
                    placeholder={field.placeholder}
                    required={field.required}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                  />
                  {field.helpText ? <small>{field.helpText}</small> : null}
                </label>
              );
            }

            if (field.type === "select") {
              return (
                <label key={field.name} className="field">
                  <span>
                    {field.label}
                    {field.required ? <em>{t("common.required")}</em> : null}
                  </span>
                  <select
                    value={value}
                    required={field.required}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                    }
                  >
                    {field.options?.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {field.helpText ? <small>{field.helpText}</small> : null}
                </label>
              );
            }

            if (field.type === "checkbox-list") {
              const selected = new Set(splitListValue(value));
              return (
                <fieldset key={field.name} className="dialog-checklist">
                  <legend>{field.label}</legend>
                  {field.options?.map((option) => (
                    <label key={option.value} className="checkbox-row">
                      <span>{option.label}</span>
                      <input
                        type="checkbox"
                        checked={selected.has(option.value)}
                        onChange={(event) =>
                          toggleListOption(field.name, option.value, event.target.checked)
                        }
                      />
                    </label>
                  ))}
                </fieldset>
              );
            }

            return (
              <label key={field.name} className="field">
                <span>
                  {field.label}
                  {field.required ? <em>{t("common.required")}</em> : null}
                </span>
                <input
                  type={field.type ?? "text"}
                  inputMode={field.type === "tel" ? "tel" : undefined}
                  value={value}
                  min={field.min}
                  max={field.max}
                  placeholder={field.placeholder}
                  required={field.required}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
                {field.helpText ? <small>{field.helpText}</small> : null}
              </label>
            );
          })}
          <div className="dialog-actions">
            <button type="button" className="button-secondary" onClick={() => closeDialog(null)}>
              {dialog.cancelLabel}
            </button>
            <button type="submit" className="button-primary">
              {dialog.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    );
  };

  return {
    openFormDialog,
    FormDialog
  };
};
