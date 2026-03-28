import { getDatabase } from '@/lib/db';
import { logger } from '../src/lib/logger';
async function runDbMigrations() {
    try {
        process.env.NEXT_PHASE = ''; // Ensure not in build phase
        process.env.MISSION_CONTROL_TEST_MODE = ''; // Ensure not in test mode
        logger.info('Attempting to run database migrations...');
        getDatabase(); // This will trigger runMigrations()
        logger.info('Database migrations command executed. Check logs for success/failure.');
    }
    catch (error) {
        logger.error({ err: error }, 'Error during migration execution');
        process.exit(1);
    }
}
runDbMigrations();
