const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { addTwitterAccount, removeTwitterAccount, getAllTwitterAccounts } = require('../database/database');
const { commands: logger } = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('twitter')
        .setDescription('Manage Twitter account notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a Twitter account to monitor')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Twitter username (without @)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove a Twitter account from monitoring')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('Twitter username (without @)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all monitored Twitter accounts')),

    async execute(interaction) {
        // Command is already deferred by the event handler
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'add': {
                    const username = interaction.options.getString('username').toLowerCase();
                    await addTwitterAccount(username);
                    await interaction.editReply({
                        content: `Now monitoring Twitter account: @${username}`,
                        ephemeral: true
                    });
                    break;
                }
                case 'remove': {
                    const username = interaction.options.getString('username').toLowerCase();
                    await removeTwitterAccount(username);
                    await interaction.editReply({
                        content: `Stopped monitoring Twitter account: @${username}`,
                        ephemeral: true
                    });
                    break;
                }
                case 'list': {
                    const accounts = await getAllTwitterAccounts();
                    
                    if (accounts.length === 0) {
                        await interaction.editReply({
                            content: 'No Twitter accounts are being monitored.',
                            ephemeral: true
                        });
                        return;
                    }

                    const accountList = accounts
                        .map(acc => `• @${acc.account_handle}`)
                        .join('\n');
                    
                    await interaction.editReply({
                        content: `**Monitored Twitter Accounts:**\n${accountList}`,
                        ephemeral: true
                    });
                    break;
                }
            }
        } catch (error) {
            logger.error(`Error in twitter command (${subcommand}):`, {
                error: error.message,
                stack: error.stack,
                username: interaction.options.getString('username'),
                user: interaction.user.tag,
                guild: interaction.guild?.name
            });

            // Let the event handler handle the error response
            throw error;
        }
    },
};
