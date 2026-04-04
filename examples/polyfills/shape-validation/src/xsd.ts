// XSD datatype validators — §8.3

const XSD_VALIDATORS: Record<string, (value: string) => boolean> = {
  'xsd:string': () => true,
  'xsd:integer': (v) => /^-?\d+$/.test(v),
  'xsd:float': (v) => !isNaN(parseFloat(v)) && isFinite(Number(v)),
  'xsd:double': (v) => !isNaN(parseFloat(v)) && isFinite(Number(v)),
  'xsd:boolean': (v) => v === 'true' || v === 'false',
  'xsd:dateTime': (v) => !isNaN(Date.parse(v)) && /T/.test(v),
  'xsd:date': (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)),
  'URI': (v) => /^[a-zA-Z][a-zA-Z0-9+\-.]*:.+$/.test(v),
};

export function validateDatatype(value: string, datatype: string): boolean {
  const validator = XSD_VALIDATORS[datatype];
  if (!validator) return true; // unknown datatype — no validation
  return validator(value);
}
