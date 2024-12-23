const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addYoutubeChannel, removeYoutubeChannel, getAllYoutubeChannels } = require('../database/database');
const youtubeIntegration = require('../integrations/youtube');
const { commands: logger } = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('youtube')
        .setDescription('Manage YouTube channel notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a YouTube channel to monitor')
                .addStringOption(option =>
                    option.setName('channel_id')
                        .setDescription('YouTube Channel ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a YouTube channel from monitoring')
                .addStringOption(option =>
                    option.setName('channel_id')
                        .setDescription('YouTube Channel ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all monitored YouTube channels')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add': {
                    const channelId = interaction.options.getString('channel_id');
                    
                    // Verify channel exists before adding
                    const channelData = await youtubeIntegration.fetchLatestVideos(channelId);
                    
                    if (!channelData) {
                        await interaction.editReply({
                            content: 'Could not find the YouTube channel. Please verify the Channel ID.',
                            ephemeral: true
                        });
                        return;
                    }

                    await addYoutubeChannel(channelId);
                    await interaction.editReply({
                        content: `Now monitoring YouTube channel: ${channelData.channel.snippet.title}\n` +
                                `Channel ID: ${channelId}`,
                        ephemeral: true
                    });
                    break;
                }
                case 'remove': {
                    const channelId = interaction.options.getString('channel_id');
                    await removeYoutubeChannel(channelId);
                    await interaction.editReply({
                        content: `Stopped monitoring YouTube channel with ID: ${channelId}`,
                        ephemeral: true
                    });
                    break;
                }
                case 'list': {
                    const channels = await getAllYoutubeChannels();
                    
                    if (channels.length === 0) {
                        await interaction.editReply({
                            content: 'No YouTube channels are being monitored.',
                            ephemeral: true
                        });
                        return;
                    }

                    // Fetch channel details for each monitored channel
                    const channelDetails = await Promise.allSettled(
                        channels.map(async (ch) => {
                            try {
                                const data = await youtubeIntegration.fetchLatestVideos(ch.channel_id);
                                return data ? 
                                    `• ${data.channel.snippet.title}\n  ID: ${ch.channel_id}` : 
                                    `• ${ch.channel_id} (channel info unavailable)`;
                            } catch (error) {
                                logger.error(`Error fetching channel details: ${ch.channel_id}`, {
                                    error: error.message,
                                    stack: error.stack
                                });
                                return `• ${ch.channel_id} (channel info unavailable)`;
                            }
                        })
                    );

                    const channelList = channelDetails
                        .map(result => result.status === 'fulfilled' ? result.value : '• Error fetching channel info')
                        .join('\n');

                    await interaction.editReply({
                        content: `**Monitored YouTube Channels:**\n${channelList}`,
                        ephemeral: true
                    });
                    break;
                }
            }
        } catch (error) {
            logger.error(`Error in youtube command (${subcommand}):`, {
                error: error.message,
                stack: error.stack,
                channelId: interaction.options.getString('channel_id'),
                user: interaction.user.tag,
                guild: interaction.guild?.name
            });

            // Let the event handler handle the error response
            throw error;
        }
    },
};
