// src/domain/user.ts
// User entity, DTOs, and validation schemas.
/** Strip sensitive fields and parse JSON columns */
export function toPublicUser(user) {
    let roles = [];
    try {
        roles = JSON.parse(user.roles);
    }
    catch {
        roles = ['user'];
    }
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
        createdAt: user.created_at,
    };
}
// ─── Validation Schemas ────────────────────────────────────────────────────────
export const createUserSchema = {
    body: {
        email: { type: 'email', required: true, max: 320 },
        name: { type: 'string', required: true, min: 1, max: 100 },
        password: { type: 'string', required: true, min: 8, max: 128 },
    },
};
export const updateUserSchema = {
    body: {
        name: { type: 'string', required: false, min: 1, max: 100 },
        email: { type: 'email', required: false, max: 320 },
    },
};
export const loginSchema = {
    body: {
        email: { type: 'email', required: true },
        password: { type: 'string', required: true, min: 1 },
    },
};
export const getUserByIdSchema = {
    params: {
        id: { type: 'uuid', required: true },
    },
};
//# sourceMappingURL=user.js.map