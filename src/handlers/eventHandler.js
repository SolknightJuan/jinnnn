const fs = require('fs');
const path = require('path');
const { Events, Collection, DiscordAPIError } = require('discord.js');
const twitterIntegration = require('../integrations/twitter');
const youtubeIntegration = require('../integrations/youtube');
const { getGuildChannels } = require('../database/database');
const { system: logger, commands: commandLogger } = require('../utils/logger');

// Track interaction states
const interactionStates = new Collection();

// Time utility functions
function getNextCheckTime(skipCount = 0) {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextMinutes = Math.ceil(minutes / 15) * 15 + (skipCount * 15);
    const next = new Date(now);
    
    // Calculate hours to add and remaining minutes
    const hoursToAdd = Math.floor(nextMinutes / 60);
    const finalMinutes = nextMinutes % 60;
    
    next.setHours(next.getHours() + hoursToAdd);
    next.setMinutes(finalMinutes);
    next.setSeconds(0);
    next.setMilliseconds(0);
    
    logger.debug('Calculated next check time', {
        currentTime: formatTime(now),
        nextCheckTime: formatTime(next),
        skipCount,
        minutesSkipped: skipCount * 15
    });
    
    return next;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
    });
}

async function safeReply(interaction, content, options = {}) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.reply({ ...content, ...options });
        } else if (interaction.deferred) {
            await interaction.editReply({ ...content, ...options });
        } else {
            await interaction.followUp({ ...content, ...options });
        }
        return true;
    } catch (error) {
        if (error instanceof DiscordAPIError) {
            if (error.code === 10062) { // Unknown interaction
                commandLogger.warn('Interaction expired before response', {
                    command: interaction.commandName,
                    user: interaction.user.tag,
                    error: error.message
                });
                return false;
            }
        }
        throw error; // Re-throw unexpected errors
    }
}

async function loadEvents(client) {
    logger.info('Setting up event handlers');

    // Set up interaction handler
    client.on(Events.InteractionCreate, async interaction => {
        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);
        if (!command) {
            commandLogger.warn(`Unknown command attempted: ${interaction.commandName}`, {
                user: interaction.user.tag,
                guild: interaction.guild?.name,
                guildId: interaction.guildId
            });
            return;
        }

        // Track interaction state
        const state = {
            status: 'started',
            timestamp: Date.now(),
            command: interaction.commandName,
            user: interaction.user.tag,
            guild: interaction.guild?.name
        };
        interactionStates.set(interaction.id, state);

        commandLogger.info(`Executing command: ${interaction.commandName}`, {
            user: interaction.user.tag,
            guild: interaction.guild?.name,
            guildId: interaction.guildId,
            options: interaction.options.data,
            interactionId: interaction.id
        });

        try {
            // Try to defer reply immediately (within 1 second)
            const deferPromise = new Promise(async (resolve, reject) => {
                try {
                    await interaction.deferReply({ ephemeral: true });
                    state.status = 'deferred';
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });

            try {
                await Promise.race([
                    deferPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Defer timeout')), 1000))
                ]);
            } catch (deferError) {
                if (deferError.message === 'Defer timeout' || 
                    (deferError instanceof DiscordAPIError && deferError.code === 10062)) {
                    commandLogger.warn('Interaction expired or timed out during deferral', {
                        command: interaction.commandName,
                        user: interaction.user.tag,
                        error: deferError.message,
                        interactionId: interaction.id
                    });
                    return; // Exit early
                }
                throw deferError;
            }

            // Execute command with 2-second timeout
            try {
                await Promise.race([
                    command.execute(interaction),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Command timeout')), 2000))
                ]);
            } catch (error) {
                if (error.message === 'Command timeout') {
                    commandLogger.warn('Command execution timed out', {
                        command: interaction.commandName,
                        user: interaction.user.tag,
                        interactionId: interaction.id
                    });
                    await safeReply(interaction, {
                        content: 'Command took too long to execute. Please try again.',
                        ephemeral: true
                    });
                    return;
                }
                throw error;
            }

            // Send success message if needed
            if (!interaction.replied) {
                await safeReply(interaction, {
                    content: `Command ${interaction.commandName} completed successfully!`,
                    ephemeral: true
                });
            }

            state.status = 'completed';
            commandLogger.info(`Command completed successfully: ${interaction.commandName}`, {
                user: interaction.user.tag,
                guild: interaction.guild?.name,
                guildId: interaction.guildId,
                interactionId: interaction.id
            });

        } catch (error) {
            state.status = 'error';
            state.error = error.message;

            commandLogger.error(`Error executing command: ${interaction.commandName}`, {
                error: error.message,
                stack: error.stack,
                user: interaction.user.tag,
                guild: interaction.guild?.name,
                guildId: interaction.guildId,
                interactionState: state
            });

            // Prepare user-friendly error message
            let errorMessage = 'There was an error executing this command!';
            
            if (error.message.includes('Channel configuration verification failed')) {
                errorMessage = '❌ Failed to save channel configuration. Please try again or contact support if the issue persists.';
            } else if (error.message.includes('Missing permissions')) {
                errorMessage = '❌ I don\'t have the required permissions in one or more channels. Please check the channel permissions and try again.';
            } else if (error.message.includes('database')) {
                errorMessage = '❌ There was a problem saving your settings. Please try again in a few minutes.';
            }

            // Attempt to send error message
            await safeReply(interaction, {
                content: errorMessage,
                ephemeral: true
            }).catch(followUpError => {
                commandLogger.error('Error sending error message to user', {
                    error: followUpError.message,
                    stack: followUpError.stack,
                    originalError: error.message,
                    interactionState: state
                });
            });
        } finally {
            // Clean up interaction state after 5 minutes
            setTimeout(() => {
                interactionStates.delete(interaction.id);
            }, 300000);
        }
    });

    client.on(Events.ClientReady, () => {
        logger.info(`Bot logged in as ${client.user.tag}`);
        startPolling(client);
    });

    client.on(Events.GuildCreate, guild => {
        logger.info(`Bot added to new guild: ${guild.name}`, {
            guildId: guild.id,
            memberCount: guild.memberCount
        });
    });

    client.on(Events.GuildDelete, guild => {
        logger.info(`Bot removed from guild: ${guild.name}`, {
            guildId: guild.id
        });
    });

    client.on(Events.Error, error => {
        logger.error('Discord client error:', {
            error: error.message,
            stack: error.stack
        });
    });
}

async function startPolling(client) {
    logger.info('Starting scheduled update polling system');

    async function findNextViableCheckTime() {
        let skipCount = 0;
        let nextCheck = getNextCheckTime(skipCount);
        const rateLimitInfo = twitterIntegration.getRateLimitInfo();

        // If we can't process now, find next viable time after rate limit reset
        if (!await twitterIntegration.canProcessAccounts()) {
            while (nextCheck.getTime() < rateLimitInfo.resetAt + 60000) { // Add 1 minute buffer
                skipCount++;
                nextCheck = getNextCheckTime(skipCount);
            }

            logger.info('Found next viable check time', {
                currentTime: formatTime(new Date()),
                nextCheckTime: formatTime(nextCheck),
                rateLimitResetAt: formatTime(new Date(rateLimitInfo.resetAt)),
                skippedIntervals: skipCount
            });
        }

        return nextCheck;
    }

    async function runChecks() {
        try {
            const now = new Date();
            logger.info(`Running scheduled checks at ${formatTime(now)}`);

            // Pre-check if we can process
            if (!await twitterIntegration.canProcessAccounts()) {
                const nextViableCheck = await findNextViableCheckTime();
                const skipDelay = nextViableCheck.getTime() - now.getTime();

                logger.info('Skipping current check due to rate limits', {
                    nextCheckTime: formatTime(nextViableCheck),
                    delayMinutes: Math.round(skipDelay / 60000),
                    rateLimitInfo: twitterIntegration.getRateLimitInfo()
                });

                setTimeout(runChecks, skipDelay);
                return;
            }

            // Process Twitter updates
            logger.debug('Starting Twitter update check');
            const tweets = await twitterIntegration.checkNewTweets();
            for (const tweetData of tweets) {
                await sendTwitterUpdate(client, tweetData).catch(error => {
                    logger.error('Error sending Twitter update:', {
                        error: error.message,
                        stack: error.stack,
                        tweetData: {
                            id: tweetData.tweet.id,
                            author: tweetData.author.username
                        }
                    });
                });
            }

            // Process YouTube updates
            logger.debug('Starting YouTube update check');
            const uploads = await youtubeIntegration.checkNewUploads();
            for (const uploadData of uploads) {
                await sendYouTubeUpdate(client, uploadData).catch(error => {
                    logger.error('Error sending YouTube update:', {
                        error: error.message,
                        stack: error.stack,
                        channelId: uploadData.channel.id
                    });
                });
            }

            // Schedule next check
            const nextCheck = await findNextViableCheckTime();
            const delay = nextCheck.getTime() - Date.now();
            
            logger.info('Scheduled next check', {
                nextCheckTime: formatTime(nextCheck),
                delayMinutes: Math.round(delay / 60000)
            });

            setTimeout(runChecks, delay);
        } catch (error) {
            logger.error('Error in scheduled checks:', {
                error: error.message,
                stack: error.stack
            });
            // If there's an error, retry in 1 minute
            setTimeout(runChecks, 60000);
        }
    }

    // Start with next viable check time
    const firstCheck = await findNextViableCheckTime();
    const initialDelay = firstCheck.getTime() - Date.now();

    logger.info('Scheduled first check', {
        firstCheckTime: formatTime(firstCheck),
        delayMinutes: Math.round(initialDelay / 60000)
    });

    setTimeout(runChecks, initialDelay);
}

async function sendTwitterUpdate(client, tweetData) {
    const { tweet, author, account } = tweetData;
    const tweetUrl = `https://twitter.com/${author.username}/status/${tweet.id}`;
    const vxTweetUrl = twitterIntegration.convertToVxTwitter(tweetUrl);
    
    logger.info(`Starting tweet update process`, {
        author: author.username,
        tweetId: tweet.id,
        tweetUrl: vxTweetUrl
    });

    // Create embed and button
    const embed = twitterIntegration.createTweetEmbed(tweet, author);
    const button = twitterIntegration.createOriginalUrlButton(tweet.id, author.username);

    // Get all guilds the bot is in
    const guilds = Array.from(client.guilds.cache.values());
    logger.info(`Processing ${guilds.length} guilds for tweet update`);

    // Send to all configured guilds
    for (const guild of guilds) {
        try {
            logger.debug(`Processing guild: ${guild.name} (${guild.id})`);
            
            // Get channel configuration
            const channels = await getGuildChannels(guild.id);
            logger.debug('Retrieved channel config:', {
                guildId: guild.id,
                guildName: guild.name,
                channels: channels ? {
                    twitter_channel_id: channels.twitter_channel_id,
                    youtube_channel_id: channels.youtube_channel_id
                } : null
            });

            if (!channels?.twitter_channel_id) {
                logger.debug(`No Twitter channel configured for guild: ${guild.name}`);
                continue;
            }

            // Try to fetch the channel
            let channel;
            try {
                channel = await guild.channels.fetch(channels.twitter_channel_id);
            } catch (fetchError) {
                logger.error(`Failed to fetch channel for guild ${guild.name}:`, {
                    error: fetchError.message,
                    channelId: channels.twitter_channel_id
                });
                continue;
            }

            if (!channel) {
                logger.warn(`Channel not found in guild ${guild.name}`, {
                    channelId: channels.twitter_channel_id
                });
                continue;
            }

            // Check permissions
            const permissions = channel.permissionsFor(client.user);
            const requiredPermissions = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
            const missingPermissions = requiredPermissions.filter(perm => !permissions.has(perm));
            
            if (missingPermissions.length > 0) {
                logger.warn(`Missing permissions in channel ${channel.name}:`, {
                    guild: guild.name,
                    channel: channel.name,
                    missingPermissions
                });
                continue;
            }

            // Send the message
            logger.info(`Attempting to send tweet to channel:`, {
                guild: guild.name,
                channel: channel.name,
                channelId: channel.id,
                author: author.username,
                tweetId: tweet.id
            });

            try {
                const message = await channel.send({
                    content: `New tweet from ${author.username}!\n${vxTweetUrl}`,
                    embeds: [embed],
                    components: [button]
                });

                logger.info(`Successfully sent tweet`, {
                    guild: guild.name,
                    channel: channel.name,
                    messageId: message.id,
                    tweetId: tweet.id
                });
            } catch (sendError) {
                logger.error(`Failed to send message`, {
                    error: sendError.message,
                    guild: guild.name,
                    channel: channel.name,
                    permissions: permissions.toArray()
                });
                throw sendError;
            }
        } catch (error) {
            logger.error(`Error sending Twitter update to guild ${guild.id}:`, {
                error: error.message,
                stack: error.stack,
                guildName: guild.name,
                tweetId: tweet.id
            });
        }
    }
}

async function sendYouTubeUpdate(client, uploadData) {
    const { channel, videos } = uploadData;

    logger.info(`Starting YouTube update process`, {
        channelName: channel.snippet.title,
        videoCount: videos.length,
        channelId: channel.id
    });

    // Get all guilds the bot is in
    const guilds = Array.from(client.guilds.cache.values());
    logger.info(`Processing ${guilds.length} guilds for YouTube update`);

    // Send to all configured guilds
    for (const guild of guilds) {
        try {
            logger.debug(`Processing guild: ${guild.name} (${guild.id})`);
            
            // Get channel configuration
            const channels = await getGuildChannels(guild.id);
            logger.debug('Retrieved channel config:', {
                guildId: guild.id,
                guildName: guild.name,
                channels: channels ? {
                    twitter_channel_id: channels.twitter_channel_id,
                    youtube_channel_id: channels.youtube_channel_id
                } : null
            });

            if (!channels?.youtube_channel_id) {
                logger.debug(`No YouTube channel configured for guild: ${guild.name}`);
                continue;
            }

            // Try to fetch the channel
            let discordChannel;
            try {
                discordChannel = await guild.channels.fetch(channels.youtube_channel_id);
            } catch (fetchError) {
                logger.error(`Failed to fetch channel for guild ${guild.name}:`, {
                    error: fetchError.message,
                    channelId: channels.youtube_channel_id
                });
                continue;
            }

            if (!discordChannel) {
                logger.warn(`Channel not found in guild ${guild.name}`, {
                    channelId: channels.youtube_channel_id
                });
                continue;
            }

            // Check permissions
            const permissions = discordChannel.permissionsFor(client.user);
            const requiredPermissions = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
            const missingPermissions = requiredPermissions.filter(perm => !permissions.has(perm));
            
            if (missingPermissions.length > 0) {
                logger.warn(`Missing permissions in channel ${discordChannel.name}:`, {
                    guild: guild.name,
                    channel: discordChannel.name,
                    missingPermissions
                });
                continue;
            }

            // Send each video update
            for (const video of videos) {
                logger.info(`Attempting to send video update to channel:`, {
                    guild: guild.name,
                    channel: discordChannel.name,
                    channelId: discordChannel.id,
                    videoId: video.id,
                    videoTitle: video.snippet.title
                });

                try {
                    const embed = youtubeIntegration.createVideoEmbed(video, channel);
                    const message = await discordChannel.send({
                        content: `New video from ${channel.snippet.title}!`,
                        embeds: [embed]
                    });

                    logger.info(`Successfully sent video update`, {
                        guild: guild.name,
                        channel: discordChannel.name,
                        messageId: message.id,
                        videoId: video.id
                    });
                } catch (sendError) {
                    logger.error(`Failed to send video update`, {
                        error: sendError.message,
                        guild: guild.name,
                        channel: discordChannel.name,
                        permissions: permissions.toArray(),
                        videoId: video.id
                    });
                    throw sendError;
                }
            }
        } catch (error) {
            logger.error(`Error sending YouTube update to guild ${guild.id}:`, {
                error: error.message,
                stack: error.stack,
                guildName: guild.name,
                channelName: channel.snippet.title
            });
        }
    }
}

module.exports = { loadEvents };
