const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const { loadCommands } = require('./handlers/commandHandler');
const { loadEvents } = require('./handlers/eventHandler');
const { initializeDatabase } = require('./database/database');
const { system: logger } = require('./utils/logger');
require('dotenv').config();

process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', {
        error: error.message,
        stack: error.stack
    });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', {
        error: error.message,
        stack: error.stack
    });
    // Give logger time to write before exiting
    setTimeout(() => process.exit(1), 1000);
});

logger.info('Starting Discord bot initialization');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    shards: 'auto'
});

client.commands = new Collection();

// Initialize database and load commands/events
(async () => {
    try {
        logger.info('Checking environment variables');
        const requiredEnvVars = [
            'DISCORD_TOKEN',
            'DISCORD_CLIENT_ID',
            'TWITTER_BEARER_TOKEN',
            'YOUTUBE_API_KEY'
        ];

        const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
        if (missingEnvVars.length > 0) {
            logger.error('Missing required environment variables:', {
                missing: missingEnvVars
            });
            process.exit(1);
        }

        logger.info('Initializing database');
        await initializeDatabase();

        logger.info('Loading commands');
        await loadCommands(client);

        logger.info('Loading events');
        await loadEvents(client);
        
        logger.info('Logging in to Discord');
        await client.login(process.env.DISCORD_TOKEN);

        // Log some stats after successful login
        client.on(Events.ClientReady, () => {
            logger.info('Bot is online and ready!', {
                username: client.user.tag,
                guilds: client.guilds.cache.size,
                commands: client.commands.size
            });

            // Log guild information
            client.guilds.cache.forEach(guild => {
                logger.debug('Connected to guild:', {
                    name: guild.name,
                    id: guild.id,
                    memberCount: guild.memberCount,
                    channelCount: guild.channels.cache.size
                });
            });
        });

    } catch (error) {
        logger.error('Error during initialization:', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
})();

// Handle shutdown gracefully
const shutdown = async () => {
    logger.info('Shutting down bot...');
    try {
        if (client.isReady()) {
            logger.info('Logging out of Discord');
            await client.destroy();
        }
        logger.info('Shutdown complete');
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
