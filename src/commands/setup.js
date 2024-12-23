const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { setGuildChannels, getGuildChannels, verifyDatabaseConnection } = require('../database/database');
const { commands: logger } = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Set up notification channels for Twitter and YouTube updates')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('twitter')
                .setDescription('Channel for Twitter updates')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('youtube')
                .setDescription('Channel for YouTube updates')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const twitterChannel = interaction.options.getChannel('twitter');
            const youtubeChannel = interaction.options.getChannel('youtube');

            // Verify bot permissions in both channels
            const requiredPermissions = ['ViewChannel', 'SendMessages', 'EmbedLinks'];
            const twitterPerms = twitterChannel.permissionsFor(interaction.client.user);
            const youtubePerms = youtubeChannel.permissionsFor(interaction.client.user);

            const missingPerms = [];
            
            logger.debug('Checking permissions for Twitter channel:', {
                channelId: twitterChannel.id,
                channelName: twitterChannel.name,
                permissions: twitterPerms?.toArray() || []
            });

            logger.debug('Checking permissions for YouTube channel:', {
                channelId: youtubeChannel.id,
                channelName: youtubeChannel.name,
                permissions: youtubePerms?.toArray() || []
            });
            
            requiredPermissions.forEach(perm => {
                if (!twitterPerms?.has(perm)) {
                    missingPerms.push(`Missing ${perm} permission in ${twitterChannel}`);
                }
                if (!youtubePerms?.has(perm)) {
                    missingPerms.push(`Missing ${perm} permission in ${youtubeChannel}`);
                }
            });

            if (missingPerms.length > 0) {
                logger.warn('Missing required permissions:', {
                    guildId: interaction.guildId,
                    guildName: interaction.guild.name,
                    missingPerms,
                    twitterChannel: {
                        id: twitterChannel.id,
                        name: twitterChannel.name
                    },
                    youtubeChannel: {
                        id: youtubeChannel.id,
                        name: youtubeChannel.name
                    }
                });

                await interaction.editReply({
                    content: `I need additional permissions to function properly:\n${missingPerms.join('\n')}`,
                    ephemeral: true
                });
                return;
            }

            logger.info('Channel permissions verified successfully', {
                guildId: interaction.guildId,
                guildName: interaction.guild.name,
                twitterChannel: {
                    id: twitterChannel.id,
                    name: twitterChannel.name,
                    permissions: twitterPerms.toArray()
                },
                youtubeChannel: {
                    id: youtubeChannel.id,
                    name: youtubeChannel.name,
                    permissions: youtubePerms.toArray()
                }
            });

            // Save channel configuration
            try {
                // First check if channels are already configured
                const existingConfig = await getGuildChannels(interaction.guildId);
                const operation = existingConfig ? 'Updating' : 'Setting up';
                
                logger.info(`${operation} channel configuration`, {
                    command: 'setup',
                    user: interaction.user.tag,
                    userId: interaction.user.id,
                    guild: interaction.guild.name,
                    guildId: interaction.guildId,
                    existing: existingConfig,
                    new: {
                        twitterChannel: {
                            id: twitterChannel.id,
                            name: twitterChannel.name,
                            type: twitterChannel.type,
                            permissions: twitterChannel.permissionsFor(interaction.client.user)?.toArray()
                        },
                        youtubeChannel: {
                            id: youtubeChannel.id,
                            name: youtubeChannel.name,
                            type: youtubeChannel.type,
                            permissions: youtubeChannel.permissionsFor(interaction.client.user)?.toArray()
                        }
                    }
                });

                // Verify database connection before saving
                await verifyDatabaseConnection();
                logger.debug('Database connection verified for channel configuration', {
                    command: 'setup',
                    guildId: interaction.guildId
                });

                const result = await setGuildChannels(
                    interaction.guildId,
                    twitterChannel.id,
                    youtubeChannel.id
                );

                logger.info('Channel configuration saved successfully', {
                    command: 'setup',
                    guild: interaction.guild.name,
                    guildId: interaction.guildId,
                    result,
                    twitterChannelId: twitterChannel.id,
                    youtubeChannelId: youtubeChannel.id,
                    operation
                });

                // Verify configuration was saved
                const savedConfig = await getGuildChannels(interaction.guildId);
                if (!savedConfig) {
                    throw new Error('Channel configuration was not saved properly');
                }

                logger.debug('Verified channel configuration:', {
                    guildId: interaction.guildId,
                    savedConfig: {
                        twitter_channel_id: savedConfig.twitter_channel_id,
                        youtube_channel_id: savedConfig.youtube_channel_id
                    }
                });

            } catch (dbError) {
                logger.error('Failed to save channel configuration:', {
                    error: dbError.message,
                    stack: dbError.stack,
                    guildId: interaction.guildId
                });
                throw dbError;
            }

            // Double-check the configuration was saved
            const verifyConfig = await getGuildChannels(interaction.guildId);
            if (!verifyConfig || 
                verifyConfig.twitter_channel_id !== twitterChannel.id || 
                verifyConfig.youtube_channel_id !== youtubeChannel.id) {
                throw new Error('Channel configuration verification failed');
            }

            // Send success message with channel mentions
            const response = [
                '✅ Notification channels configured successfully!',
                '',
                `📱 Twitter updates will be sent to ${twitterChannel}`,
                `🎥 YouTube updates will be sent to ${youtubeChannel}`,
                '',
                'You can now:',
                '• Use `/twitter add <username>` to monitor Twitter accounts',
                '• Use `/youtube add <channel_id>` to monitor YouTube channels',
                '',
                '⚠️ Make sure I have permission to send messages in these channels!'
            ].join('\n');

            await interaction.editReply({
                content: response,
                ephemeral: true
            });

            logger.info('Setup command completed successfully', {
                guild: interaction.guild.name,
                guildId: interaction.guildId,
                twitterChannel: {
                    id: twitterChannel.id,
                    name: twitterChannel.name
                },
                youtubeChannel: {
                    id: youtubeChannel.id,
                    name: youtubeChannel.name
                }
            });

        } catch (error) {
            logger.error('Error in setup command:', {
                error: error.message,
                stack: error.stack,
                user: interaction.user.tag,
                guild: interaction.guild?.name,
                guildId: interaction.guildId
            });

            // Let the event handler handle the error response
            throw error;
        }
    },
};
