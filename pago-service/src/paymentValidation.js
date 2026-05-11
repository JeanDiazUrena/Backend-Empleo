import crypto from "crypto";

const onlyDigits = (value = "") => String(value).replace(/\D/g, "");

const detectCardBrand = (value = "") => {
    const digits = onlyDigits(value);
    if (/^4/.test(digits)) return { key: "visa", label: "Visa", lengths: [13, 16, 19], cvcLength: 3 };
    if (/^3[47]/.test(digits)) return { key: "amex", label: "American Express", lengths: [15], cvcLength: 4 };

    const firstTwo = Number(digits.slice(0, 2));
    const firstFour = Number(digits.slice(0, 4));
    if ((firstTwo >= 51 && firstTwo <= 55) || (firstFour >= 2221 && firstFour <= 2720)) {
        return { key: "mastercard", label: "MasterCard", lengths: [16], cvcLength: 3 };
    }

    return { key: "card", label: "Tarjeta", lengths: [], cvcLength: 3 };
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

const repeatedOnly = (digits = "") => /^(\d)\1+$/.test(digits);

const sequentialOnly = (digits = "") => {
    if (digits.length < 8) return false;
    return "01234567890123456789".includes(digits) || "98765432109876543210".includes(digits);
};

const validateHolderName = (value = "") => {
    const name = String(value).trim().replace(/\s+/g, " ");
    return name.length >= 5 && name.split(" ").filter(Boolean).length >= 2 && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]+$/.test(name);
};

const validateExpiry = (value = "") => {
    const match = String(value).trim().match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    if (!match) return false;
    const month = Number(match[1]);
    const year = 2000 + Number(match[2]);
    return new Date(year, month, 0, 23, 59, 59, 999) >= new Date();
};

export const validatePaymentCard = ({ card_number, number, exp, holder_name, name, brand } = {}) => {
    const digits = onlyDigits(card_number || number);
    const detectedBrand = detectCardBrand(digits);
    const holderName = String(holder_name || name || "").trim().replace(/\s+/g, " ");
    const normalizedExp = String(exp || "").trim();

    if (!validateHolderName(holderName)) {
        return { valid: false, message: "Escribe nombre y apellido del titular." };
    }

    if (
        detectedBrand.key === "card" ||
        !detectedBrand.lengths.includes(digits.length) ||
        repeatedOnly(digits) ||
        sequentialOnly(digits) ||
        !passesLuhn(digits)
    ) {
        return { valid: false, message: "Ingresa un número válido de Visa, MasterCard o American Express." };
    }

    if (!validateExpiry(normalizedExp)) {
        return { valid: false, message: "La fecha de vencimiento no es válida o ya está vencida." };
    }

    return {
        valid: true,
        data: {
            brand: detectedBrand.label || brand,
            holder_name: holderName,
            last4: digits.slice(-4),
            exp: normalizedExp,
            fingerprint: crypto
                .createHmac("sha256", process.env.FINANCIAL_DATA_SECRET || process.env.JWT_SECRET || "servihub-local")
                .update(digits)
                .digest("hex")
        }
    };
};
