function matchesType(value, expectedType) {
    if (expectedType === 'array') {
        return Array.isArray(value);
    }

    if (expectedType === 'object') {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    if (expectedType === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }

    return typeof value === expectedType;
}

export function validateSchema(input, schema = {}) {
    const errors = [];

    if (!schema || typeof schema !== 'object') {
        return errors;
    }

    if (schema.type === 'object' && (typeof input !== 'object' || input == null || Array.isArray(input))) {
        errors.push('Input must be an object.');
        return errors;
    }

    for (const field of schema.required || []) {
        if (input[field] === undefined) {
            errors.push(`Missing required field: ${field}`);
        }
    }

    for (const [field, definition] of Object.entries(schema.properties || {})) {
        const value = input[field];
        if (value === undefined || value === null) {
            continue;
        }

        if (definition.type && !matchesType(value, definition.type)) {
            errors.push(`Field "${field}" must be of type ${definition.type}.`);
            continue;
        }

        if (definition.enum && !definition.enum.includes(value)) {
            errors.push(`Field "${field}" must be one of: ${definition.enum.join(', ')}`);
        }
    }

    return errors;
}
