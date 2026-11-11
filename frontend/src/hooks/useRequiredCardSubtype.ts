import { useState } from "react";
import type { SubtypeDef } from "@/types";

/** Data Object creation requires a subtype declared by the metamodel. */
export function useRequiredCardSubtype(type: string, options: SubtypeDef[] = []) {
  const [value, setValue] = useState("");
  const required = type === "DataObject";
  const subtype = required && options.some((option) => option.key === value) ? value : "";

  return {
    subtype,
    subtypeValid: !required || !!subtype,
    subtypeField: required ? { options, value: subtype, onChange: setValue } : null,
    resetSubtype: () => setValue(""),
  };
}
