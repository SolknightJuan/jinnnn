const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { commands: logger } = require('../utils/logger');

const commands = [];
const commandFiles = fs.readdirSync(path.join(__dirname, '../commands'))
    .filter(file => file.endsWith('.js'));

// Load all command files
for (const file of commandFiles) {
    try {
        const command = require(`../commands/${file}`);
        logger.debug(`Loading command file: ${file}`);
        commands.push(command.data.toJSON());
    } catch (error) {
        logger.error(`Error loading command file: ${file}`, {
            error: error.message,
            stack: error.stack
        });
    }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

async function deployCommands() {
    try {
        logger.info('Started refreshing application (/) commands', {
            commandCount: commands.length
        });

        // Log command details before deployment
        commands.forEach(cmd => {
            logger.debug('Deploying command:', {
                name: cmd.name,
                description: cmd.description,
                options: cmd.options
            });
        });

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands },
        );

        logger.info('Successfully reloaded application (/) commands', {
            deployedCount: data.length
        });
    } catch (error) {
        logger.error('Error deploying commands:', {
            error: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        throw error;
    }
}

async function loadCommands(client) {
    logger.info('Loading commands into client');
    const commands = [];
    const commandFiles = fs.readdirSync(path.join(__dirname, '../commands'))
        .filter(file => file.endsWith('.js'));

    // Load commands with faster response handling
    for (const file of commandFiles) {
        try {
            const command = require(`../commands/${file}`);
            const commandData = command.data.toJSON();
            
            // Wrap command execution with timeout handling
            const wrappedExecute = command.execute;
            command.execute = async (interaction) => {
                try {
                    // Set up timeout for command execution
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Command execution timeout')), 2500);
                    });

                    // Race between command execution and timeout
                    await Promise.race([
                        wrappedExecute(interaction),
                        timeoutPromise
                    ]);
                } catch (error) {
                    if (error.message === 'Command execution timeout') {
                        logger.warn(`Command ${command.data.name} timed out`, {
                            user: interaction.user.tag,
                            guild: interaction.guild?.name
                        });
                    }
                    throw error;
                }
            };

            commands.push(commandData);
            client.commands.set(command.data.name, command);
            
            logger.debug(`Loaded command: ${command.data.name}`, {
                description: command.data.description,
                options: command.data.options
            });
        } catch (error) {
            logger.error(`Error loading command file: ${file}`, {
                error: error.message,
                stack: error.stack
            });
        }
    }

    // Deploy commands to Discord
    try {
        const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
        
        logger.info('Started refreshing application (/) commands', {
            commandCount: commands.length
        });

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
            { body: commands }
        );

        logger.info('Successfully reloaded application (/) commands', {
            deployedCount: data.length
        });
    } catch (error) {
        logger.error('Error deploying commands:', {
            error: error.message,
            stack: error.stack
        });
        // Don't throw here - we want the bot to start even if command deployment fails
        // Commands can be deployed later manually if needed
    }

    logger.info('Command loading completed', {
        totalCommands: client.commands.size
    });
}

module.exports = { loadCommands };
