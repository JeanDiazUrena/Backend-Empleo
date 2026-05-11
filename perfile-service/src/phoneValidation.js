const DOMINICAN_AREA_CODES = new Set(["809", "829", "849"]);
const PUERTO_RICO_AREA_CODES = new Set(["787", "939"]);

const COUNTRY_RULES = [
  { code: "58", name: "Venezuela", min: 10, max: 10 },
  { code: "57", name: "Colombia", min: 10, max: 10 },
  { code: "52", name: "Mexico", min: 10, max: 10 },
  { code: "506", name: "Costa Rica", min: 8, max: 8 },
  { code: "507", name: "Panama", min: 8, max: 8 },
  { code: "503", name: "El Salvador", min: 8, max: 8 },
  { code: "502", name: "Guatemala", min: 8, max: 8 },
  { code: "34", name: "Espana", min: 9, max: 9 },
  { code: "1", name: "Estados Unidos / Canada", min: 10, max: 10 }
];

const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

const hasFakePattern = (digits) => {
  if (!digits) return true;
  if (/^(\d)\1+$/.test(digits)) return true;
  return "01234567890".includes(digits) || "09876543210".includes(digits);
};

const formatGrouped = (digits, groups) => {
  const parts = [];
  let cursor = 0;

  for (const size of groups) {
    const next = digits.slice(cursor, cursor + size);
    if (next) parts.push(next);
    cursor += size;
  }

  const rest = digits.slice(cursor);
  if (rest) parts.push(rest);
  return parts.join("-");
};

const detectNanpCountry = (nationalNumber) => {
  const areaCode = nationalNumber.slice(0, 3);
  if (DOMINICAN_AREA_CODES.has(areaCode)) return "Republica Dominicana";
  if (PUERTO_RICO_AREA_CODES.has(areaCode)) return "Puerto Rico";
  return "Estados Unidos / Canada";
};

const detectCountry = (digits, hasInternationalPrefix) => {
  if (!digits) return null;

  if (!hasInternationalPrefix && digits.length <= 10) {
    return { code: "1", name: detectNanpCountry(digits), nationalNumber: digits };
  }

  const rule = [...COUNTRY_RULES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((item) => digits.startsWith(item.code));

  if (!rule) return null;

  const nationalNumber = digits.slice(rule.code.length);
  return {
    code: rule.code,
    name: rule.code === "1" ? detectNanpCountry(nationalNumber) : rule.name,
    nationalNumber
  };
};

const formatNational = (countryCode, nationalNumber) => {
  if (countryCode === "1") return formatGrouped(nationalNumber.slice(0, 10), [3, 3, 4]);
  if (countryCode === "52") return formatGrouped(nationalNumber.slice(0, 10), [2, 4, 4]);
  if (countryCode === "34") return formatGrouped(nationalNumber.slice(0, 9), [3, 3, 3]);
  if (nationalNumber.length <= 8) return formatGrouped(nationalNumber, [4, 4]);
  return formatGrouped(nationalNumber.slice(0, 12), [3, 3, 3, 3]);
};

export const normalizeAndValidatePhone = (value = "") => {
  const raw = String(value || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = onlyDigits(raw);
  const hasInternationalPrefix = hasPlus || digits.length > 10;
  const detected = detectCountry(digits, hasInternationalPrefix);

  if (!digits) return { ok: false, message: "Ingresa un numero de telefono." };
  if (!detected) return { ok: false, message: "Incluye un codigo de pais valido o un numero local real." };

  const { code, nationalNumber } = detected;
  if (hasFakePattern(nationalNumber)) {
    return { ok: false, message: "Ese numero no parece real. Usa un telefono valido." };
  }

  if (code === "1") {
    const areaCode = nationalNumber.slice(0, 3);
    const exchange = nationalNumber.slice(3, 6);
    const isDominican = DOMINICAN_AREA_CODES.has(areaCode);
    const isPuertoRico = PUERTO_RICO_AREA_CODES.has(areaCode);

    if (nationalNumber.length !== 10) {
      return { ok: false, message: "El telefono debe tener 10 digitos." };
    }

    if (!/^[2-9]\d{2}$/.test(areaCode) || !/^[2-9]\d{2}$/.test(exchange)) {
      return { ok: false, message: "El codigo de area o central no es valido." };
    }

    if (!hasInternationalPrefix && !isDominican && !isPuertoRico) {
      return { ok: false, message: "Para numeros fuera de Republica Dominicana usa el codigo de pais." };
    }
  } else {
    const rule = COUNTRY_RULES.find((item) => item.code === code);
    if (rule && (nationalNumber.length < rule.min || nationalNumber.length > rule.max)) {
      return { ok: false, message: `El telefono de ${rule.name} debe tener ${rule.min === rule.max ? rule.min : `${rule.min}-${rule.max}`} digitos.` };
    }
  }

  const formattedNational = formatNational(code, nationalNumber);
  return {
    ok: true,
    country: detected.name,
    e164: `+${code}${nationalNumber}`,
    formatted: hasInternationalPrefix ? `+${code} ${formattedNational}` : formattedNational
  };
};
