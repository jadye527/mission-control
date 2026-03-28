import pino from 'pino';
function hasPinoPretty() {
    try {
        require.resolve('pino-pretty');
        return true;
    }
    catch (_a) {
        return false;
    }
}
const usePretty = process.env.NODE_ENV !== 'production' && hasPinoPretty();
export const logger = pino(Object.assign({ level: process.env.LOG_LEVEL || 'info' }, (usePretty && {
    transport: {
        target: 'pino-pretty',
        options: { colorize: true },
    },
})));
