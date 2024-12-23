const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { database: logger } = require('../utils/logger');
require('dotenv').config();

let db;

const verifyDatabaseConnection = async () => {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }

        db.get('SELECT 1', (err) => {
            if (err) {
                logger.error('Database connection check failed:', {
                    error: err.message,
                    stack: err.stack
                });
                reject(err);
            } else {
                logger.debug('Database connection verified');
                resolve(true);
            }
        });
    });
};

const initializeDatabase = () => {
    return new Promise(async (resolve, reject) => {
        try {
            // Ensure data directory exists
            const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/database.sqlite');
            const dbDir = path.dirname(dbPath);
            
            logger.info(`Ensuring database directory exists: ${dbDir}`);
            fs.mkdirSync(dbDir, { recursive: true });
            
            logger.info(`Initializing database at: ${dbPath}`);
            db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    logger.error('Database initialization error:', {
                        error: err.message,
                        stack: err.stack,
                        path: dbPath
                    });
                    reject(err);
                    return;
                }

                // Create tables
                db.serialize(() => {
                    logger.info('Creating database tables if they don\'t exist');
                    db.run(`
                        CREATE TABLE IF NOT EXISTS twitter_accounts (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            account_handle TEXT UNIQUE NOT NULL,
                            last_tweet_id TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    db.run(`
                        CREATE TABLE IF NOT EXISTS youtube_channels (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            channel_id TEXT UNIQUE NOT NULL,
                            last_video_id TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);

                    db.run(`
                        CREATE TABLE IF NOT EXISTS discord_channels (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            guild_id TEXT NOT NULL,
                            twitter_channel_id TEXT,
                            youtube_channel_id TEXT,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(guild_id)
                        )
                    `, (err) => {
                        if (err) {
                            logger.error('Error creating tables:', {
                                error: err.message,
                                stack: err.stack
                            });
                            reject(err);
                        } else {
                            logger.info('Database initialized successfully');
                            // Verify the connection after initialization
                            verifyDatabaseConnection()
                                .then(() => {
                                    resolve(db);
                                })
                                .catch((verifyError) => {
                                    logger.error('Database verification failed:', {
                                        error: verifyError.message,
                                        stack: verifyError.stack
                                    });
                                    reject(verifyError);
                                });
                        }
                    });
                });
            });
        } catch (error) {
            logger.error('Error during database setup:', {
                error: error.message,
                stack: error.stack
            });
            reject(error);
        }
    });
};

// Twitter account management
const addTwitterAccount = (handle) => {
    return new Promise((resolve, reject) => {
        logger.info(`Adding Twitter account: ${handle}`);
        const stmt = db.prepare('INSERT OR IGNORE INTO twitter_accounts (account_handle) VALUES (?)');
        stmt.run(handle, function(err) {
            if (err) {
                logger.error(`Error adding Twitter account: ${handle}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.info(`Twitter account added successfully: ${handle}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

const removeTwitterAccount = (handle) => {
    return new Promise((resolve, reject) => {
        logger.info(`Removing Twitter account: ${handle}`);
        const stmt = db.prepare('DELETE FROM twitter_accounts WHERE account_handle = ?');
        stmt.run(handle, function(err) {
            if (err) {
                logger.error(`Error removing Twitter account: ${handle}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.info(`Twitter account removed successfully: ${handle}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

const getAllTwitterAccounts = () => {
    return new Promise((resolve, reject) => {
        logger.debug('Fetching all Twitter accounts');
        db.all('SELECT * FROM twitter_accounts', (err, rows) => {
            if (err) {
                logger.error('Error fetching Twitter accounts', {
                    error: err.message
                });
                reject(err);
            } else {
                logger.debug('Twitter accounts fetched successfully', {
                    count: rows.length
                });
                resolve(rows);
            }
        });
    });
};

const updateLastTweetId = (handle, tweetId) => {
    return new Promise((resolve, reject) => {
        logger.debug(`Updating last tweet ID for ${handle}`, {
            tweetId
        });
        const stmt = db.prepare('UPDATE twitter_accounts SET last_tweet_id = ? WHERE account_handle = ?');
        stmt.run(tweetId, handle, function(err) {
            if (err) {
                logger.error(`Error updating last tweet ID for ${handle}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.debug(`Last tweet ID updated for ${handle}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

// YouTube channel management
const addYoutubeChannel = (channelId) => {
    return new Promise((resolve, reject) => {
        logger.info(`Adding YouTube channel: ${channelId}`);
        const stmt = db.prepare('INSERT OR IGNORE INTO youtube_channels (channel_id) VALUES (?)');
        stmt.run(channelId, function(err) {
            if (err) {
                logger.error(`Error adding YouTube channel: ${channelId}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.info(`YouTube channel added successfully: ${channelId}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

const removeYoutubeChannel = (channelId) => {
    return new Promise((resolve, reject) => {
        logger.info(`Removing YouTube channel: ${channelId}`);
        const stmt = db.prepare('DELETE FROM youtube_channels WHERE channel_id = ?');
        stmt.run(channelId, function(err) {
            if (err) {
                logger.error(`Error removing YouTube channel: ${channelId}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.info(`YouTube channel removed successfully: ${channelId}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

const getAllYoutubeChannels = () => {
    return new Promise((resolve, reject) => {
        logger.debug('Fetching all YouTube channels');
        db.all('SELECT * FROM youtube_channels', (err, rows) => {
            if (err) {
                logger.error('Error fetching YouTube channels', {
                    error: err.message
                });
                reject(err);
            } else {
                logger.debug('YouTube channels fetched successfully', {
                    count: rows.length
                });
                resolve(rows);
            }
        });
    });
};

const updateLastVideoId = (channelId, videoId) => {
    return new Promise((resolve, reject) => {
        logger.debug(`Updating last video ID for ${channelId}`, {
            videoId
        });
        const stmt = db.prepare('UPDATE youtube_channels SET last_video_id = ? WHERE channel_id = ?');
        stmt.run(videoId, channelId, function(err) {
            if (err) {
                logger.error(`Error updating last video ID for ${channelId}`, {
                    error: err.message
                });
                reject(err);
            } else {
                logger.debug(`Last video ID updated for ${channelId}`, {
                    changes: this.changes
                });
                resolve(this);
            }
        });
        stmt.finalize();
    });
};

// Discord channel management
const setGuildChannels = (guildId, twitterChannelId, youtubeChannelId) => {
    return new Promise((resolve, reject) => {
        logger.info(`Setting channels for guild: ${guildId}`, {
            twitterChannelId,
            youtubeChannelId
        });

        // First check if the guild already has channels configured
        db.get('SELECT * FROM discord_channels WHERE guild_id = ?', [guildId], (err, row) => {
            if (err) {
                logger.error(`Error checking existing channels for guild: ${guildId}`, {
                    error: err.message,
                    stack: err.stack
                });
                reject(err);
                return;
            }

            const operation = row ? 'update' : 'insert';
            logger.debug(`Performing ${operation} operation for guild channels`, {
                guildId,
                existing: row,
                new: {
                    twitter_channel_id: twitterChannelId,
                    youtube_channel_id: youtubeChannelId
                }
            });

            const stmt = db.prepare(`
                INSERT INTO discord_channels (guild_id, twitter_channel_id, youtube_channel_id)
                VALUES (?, ?, ?)
                ON CONFLICT(guild_id) 
                DO UPDATE SET 
                    twitter_channel_id = excluded.twitter_channel_id,
                    youtube_channel_id = excluded.youtube_channel_id
            `);

            stmt.run(guildId, twitterChannelId, youtubeChannelId, function(err) {
                if (err) {
                    logger.error(`Error ${operation} channels for guild: ${guildId}`, {
                        error: err.message,
                        stack: err.stack,
                        params: {
                            guildId,
                            twitterChannelId,
                            youtubeChannelId
                        }
                    });
                    reject(err);
                } else {
                    logger.info(`Channels ${operation}d successfully for guild: ${guildId}`, {
                        changes: this.changes,
                        operation,
                        channels: {
                            twitter: twitterChannelId,
                            youtube: youtubeChannelId
                        }
                    });
                    resolve({
                        operation,
                        changes: this.changes,
                        lastID: this.lastID
                    });
                }
            });
            stmt.finalize();
        });
    });
};

const getGuildChannels = (guildId) => {
    return new Promise((resolve, reject) => {
        logger.debug(`Fetching channels for guild: ${guildId}`);
        
        if (!guildId) {
            const error = new Error('Guild ID is required');
            logger.error('Invalid guild ID provided', { error: error.message });
            reject(error);
            return;
        }

        db.get('SELECT * FROM discord_channels WHERE guild_id = ?', [guildId], (err, row) => {
            if (err) {
                logger.error(`Error fetching channels for guild: ${guildId}`, {
                    error: err.message,
                    stack: err.stack
                });
                reject(err);
                return;
            }

            if (!row) {
                logger.debug(`No channels configured for guild: ${guildId}`);
                resolve(null);
                return;
            }

            logger.debug(`Channels fetched successfully for guild: ${guildId}`, {
                channels: {
                    twitter_channel_id: row.twitter_channel_id,
                    youtube_channel_id: row.youtube_channel_id
                }
            });
            resolve(row);
        });
    });
};

const getConfiguredGuilds = () => {
    return new Promise((resolve, reject) => {
        logger.debug('Fetching all configured guild channels');
        db.all('SELECT * FROM discord_channels WHERE twitter_channel_id IS NOT NULL', (err, rows) => {
            if (err) {
                logger.error('Error fetching configured guilds:', {
                    error: err.message,
                    stack: err.stack
                });
                reject(err);
                return;
            }

            logger.debug(`Found ${rows?.length || 0} configured guilds`);
            resolve(rows || []);
        });
    });
};

module.exports = {
    initializeDatabase,
    verifyDatabaseConnection,
    addTwitterAccount,
    removeTwitterAccount,
    getAllTwitterAccounts,
    updateLastTweetId,
    addYoutubeChannel,
    removeYoutubeChannel,
    getAllYoutubeChannels,
    updateLastVideoId,
    setGuildChannels,
    getGuildChannels,
    getConfiguredGuilds,
    get db() { return db; }
};
