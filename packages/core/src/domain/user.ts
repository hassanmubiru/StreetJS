// src/domain/user.ts
// User entity, DTOs, and validation schemas.

import type { ValidationSchema } from '../core/types.js';

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  roles: string;
  created_at: string;
  updated_at: string;
}

export interface UserPublic {
  id: string;
  email: string;
  name: string;
  roles: string[];
  createdAt: string;
}

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

/** Strip sensitive fields and parse JSON columns */
export function toPublicUser(user: User): UserPublic {
  let roles: string[] = [];
  try {
    roles = JSON.parse(user.roles) as string[];
  } catch {
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

export const createUserSchema: ValidationSchema = {
  body: {
    email: { type: 'email', required: true, max: 320 },
    name: { type: 'string', required: true, min: 1, max: 100 },
    password: { type: 'string', required: true, min: 8, max: 128 },
  },
};

export const updateUserSchema: ValidationSchema = {
  body: {
    name: { type: 'string', required: false, min: 1, max: 100 },
    email: { type: 'email', required: false, max: 320 },
  },
};

export const loginSchema: ValidationSchema = {
  body: {
    email: { type: 'email', required: true },
    password: { type: 'string', required: true, min: 1 },
  },
};

export const getUserByIdSchema: ValidationSchema = {
  params: {
    id: { type: 'uuid', required: true },
  },
};
