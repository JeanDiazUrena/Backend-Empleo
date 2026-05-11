import crypto from "crypto";

const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

const getSecretKey = () =>
    crypto
        .createHash("sha256")
        .update(process.env.FINANCIAL_DATA_SECRET || process.env.JWT_SECRET || "servihub-local-financial-secret")
        .digest();

export const encryptValue = (value = "") => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", getSecretKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decryptValue = (value = "") => {
    if (!value || !String(value).includes(":")) return value || "";
    const [ivHex, tagHex, encryptedHex] = String(value).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", getSecretKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final()
    ]).toString("utf8");
};

const repeatedOnly = (digits = "") => /^(\d)\1+$/.test(digits);

const sequentialOnly = (digits = "") => {
    if (digits.length < 8) return false;
    return "01234567890123456789".includes(digits) || "98765432109876543210".includes(digits);
};

const validateHolderName = (value = "") => {
    const name = String(value).trim().replace(/\s+/g, " ");
    return name.length >= 5 && name.split(" ").filter(Boolean).length >= 2 && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/.test(name);
};

export const maskBankAccount = (value = "") => {
    const digits = onlyDigits(value);
    if (!digits) return "";
    return `****${digits.slice(-4)}`;
};

export const validateBankAccount = ({ titular, banco, numero_cuenta, accountNumber, holderName, bankName, tipo_cuenta } = {}) => {
    const normalizedHolder = String(titular || holderName || "").trim().replace(/\s+/g, " ");
    const normalizedBank = String(banco || bankName || "").trim();
    const digits = onlyDigits(numero_cuenta || accountNumber);

    if (!validateHolderName(normalizedHolder)) {
        return { valid: false, message: "Escribe nombre y apellido del titular de la cuenta." };
    }

    if (!normalizedBank) {
        return { valid: false, message: "Selecciona el banco de la cuenta." };
    }

    if (digits.length < 8 || digits.length > 20 || repeatedOnly(digits) || sequentialOnly(digits)) {
        return { valid: false, message: "Ingresa un número de cuenta bancaria válido." };
    }

    return {
        valid: true,
        data: {
            titular: normalizedHolder,
            banco: normalizedBank,
            numero_cuenta: digits,
            tipo_cuenta: String(tipo_cuenta || "Ahorros").trim() || "Ahorros",
            last4: digits.slice(-4)
        }
    };
};

const detectCardBrand = (value = "") => {
    const digits = onlyDigits(value);
    if (/^4/.test(digits)) return { key: "visa", label: "Visa", lengths: [13, 16, 19] };
    if (/^3[47]/.test(digits)) return { key: "amex", label: "American Express", lengths: [15] };
    const firstTwo = Number(digits.slice(0, 2));
    const firstFour = Number(digits.slice(0, 4));
    if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) {
        return { key: "mastercard", label: "MasterCard", lengths: [16] };
    }
    return { key: "card", label: "Tarjeta", lengths: [] };
};

const passesLuhn = (value = "") => {
    const digits = onlyDigits(value);
    let sum = 0;
    let shouldDouble = false;

    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let digit = Number(digits[i]);
        if (shouldDouble) {
            digit *= 2;
            if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
    }

    return digits.length > 0 && sum % 10 === 0;
};

const validateExpiry = (value = "") => {
    const match = String(value).trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!match) return false;
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    return new Date(year, month, 0, 23, 59, 59, 999) >= new Date();
};

export const validateCommissionCard = ({ card_number, card_exp, card_holder } = {}) => {
    const digits = onlyDigits(card_number);
    const brand = detectCardBrand(digits);
    const holder = String(card_holder || "").trim().replace(/\s+/g, " ");

    if (!digits) return { valid: true, data: null };
    if (!validateHolderName(holder)) return { valid: false, message: "Escribe nombre y apellido del titular de la tarjeta." };
    if (brand.key === "card" || !brand.lengths.includes(digits.length) || repeatedOnly(digits) || sequentialOnly(digits) || !passesLuhn(digits)) {
        return { valid: false, message: "Ingresa una tarjeta válida para comisiones." };
    }
    if (!validateExpiry(card_exp)) return { valid: false, message: "La fecha de la tarjeta de comisiones no es válida." };

    const fingerprint = crypto
        .createHmac("sha256", process.env.FINANCIAL_DATA_SECRET || process.env.JWT_SECRET || "servihub-local")
        .update(digits)
        .digest("hex");

    return {
        valid: true,
        data: {
            brand: brand.label,
            holder,
            last4: digits.slice(-4),
            exp: String(card_exp).trim(),
            token: `commission_${brand.key}_${digits.slice(-4)}_${fingerprint.slice(0, 18)}`
        }
    };
};
