"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("next-intl/server");
const headers_1 = require("next/headers");
const config_1 = require("./config");
exports.default = (0, server_1.getRequestConfig)(async () => {
    var _a;
    let locale = config_1.defaultLocale;
    // 1. Check NEXT_LOCALE cookie
    const cookieStore = await (0, headers_1.cookies)();
    const cookieLocale = (_a = cookieStore.get('NEXT_LOCALE')) === null || _a === void 0 ? void 0 : _a.value;
    if (cookieLocale && config_1.locales.includes(cookieLocale)) {
        locale = cookieLocale;
    }
    else {
        // 2. Fall back to Accept-Language header
        const headerStore = await (0, headers_1.headers)();
        const acceptLang = headerStore.get('accept-language') || '';
        const preferred = acceptLang
            .split(',')
            .map((part) => part.split(';')[0].trim().substring(0, 2).toLowerCase())
            .find((code) => config_1.locales.includes(code));
        if (preferred) {
            locale = preferred;
        }
    }
    return {
        locale,
        messages: (await Promise.resolve(`${`../../messages/${locale}.json`}`).then(s => __importStar(require(s)))).default,
    };
});
