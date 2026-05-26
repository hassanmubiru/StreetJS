// src/config/index.ts
// Application configuration loaded from environment variables.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '../core/container.js';
import { Config } from '../core/decorators.js';
import { loadConfig } from '../security/vault.js';
let AppConfig = class AppConfig {
    port = '3000';
    host = '0.0.0.0';
    pgHost = '';
    pgPort = '5432';
    pgDatabase = '';
    pgUser = '';
    pgPassword = '';
    jwtSecret = '';
    sessionKey = '';
    nodeEnv = 'development';
    uploadsDir = './uploads';
    migrationsDir = './migrations';
    /** Load all config values from environment */
    load(kek) {
        return loadConfig(this, kek);
    }
    get isProduction() {
        return this.nodeEnv === 'production';
    }
    get isDevelopment() {
        return this.nodeEnv === 'development';
    }
    get httpPort() {
        return parseInt(this.port, 10) || 3000;
    }
    get pgPortNumber() {
        return parseInt(this.pgPort, 10) || 5432;
    }
};
__decorate([
    Config('PORT', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "port", void 0);
__decorate([
    Config('HOST', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "host", void 0);
__decorate([
    Config('PG_HOST', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "pgHost", void 0);
__decorate([
    Config('PG_PORT', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "pgPort", void 0);
__decorate([
    Config('PG_DATABASE', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "pgDatabase", void 0);
__decorate([
    Config('PG_USER', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "pgUser", void 0);
__decorate([
    Config('PG_PASSWORD', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "pgPassword", void 0);
__decorate([
    Config('JWT_SECRET', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "jwtSecret", void 0);
__decorate([
    Config('SESSION_KEY', { required: true }),
    __metadata("design:type", String)
], AppConfig.prototype, "sessionKey", void 0);
__decorate([
    Config('NODE_ENV', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "nodeEnv", void 0);
__decorate([
    Config('UPLOADS_DIR', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "uploadsDir", void 0);
__decorate([
    Config('MIGRATIONS_DIR', { required: false }),
    __metadata("design:type", String)
], AppConfig.prototype, "migrationsDir", void 0);
AppConfig = __decorate([
    Injectable()
], AppConfig);
export { AppConfig };
//# sourceMappingURL=index.js.map