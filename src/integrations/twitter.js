const axios = require('axios');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getAllTwitterAccounts, updateLastTweetId, db, verifyDatabaseConnection } = require('../database/database');
const { twitter: logger } = require('../utils/logger');

class TwitterIntegration {
    constructor() {
        logger.info('Initializing Twitter integration');
        this.api = axios.create({
            baseURL: 'https://api.twitter.com/2',
            headers: {
                'Authorization': `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
            }
        });
        this.rateLimit = {
            remaining: 180,
            resetAt: Date.now() + 900000, // 15 minutes
            lastReset: Date.now()
        };
        this.backoffTime = 0;
        this.lastRequestTime = 0;
        this.minRequestInterval = 10000; // Minimum 10 seconds between requests
        this.maxRequestsPerBatch = 5; // Process 5 accounts at a time
        this.requestCount = 0;
        this.batchInterval = 60000; // 1 minute between batches
        this.bufferThreshold = 100; // Keep 100 requests as buffer
        this.maxRetries = 3; // Maximum retries per request

        logger.debug('Twitter API client created with rate limit settings', {
            rateLimitRemaining: this.rateLimit.remaining,
            minRequestInterval: this.minRequestInterval,
            maxRequestsPerBatch: this.maxRequestsPerBatch,
            batchInterval: this.batchInterval,
            bufferThreshold: this.bufferThreshold
        });
    }

    // Rate limit checking methods
    getRateLimitInfo() {
        return {
            remaining: this.rateLimit.remaining,
            resetAt: this.rateLimit.resetAt,
            backoffTime: this.backoffTime,
            requestCount: this.requestCount
        };
    }

    async canProcessAccounts() {
        try {
            const accounts = await getAllTwitterAccounts();
            const requiredRequests = accounts.length;
            const now = Date.now();

            // If we're in backoff, we can't process
            if (this.backoffTime > 0) {
                logger.debug('Cannot process - in backoff period', {
                    backoffTime: this.backoffTime
                });
                return false;
            }

            // If we've hit batch limit
            if (this.requestCount >= this.maxRequestsPerBatch) {
                logger.debug('Cannot process - batch limit reached', {
                    requestCount: this.requestCount,
                    maxRequests: this.maxRequestsPerBatch
                });
                return false;
            }

            // Check if we have enough remaining requests
            const neededWithBuffer = requiredRequests + 5; // Add buffer
            if (this.rateLimit.remaining < neededWithBuffer) {
                // Only return false if reset is not imminent
                if (this.rateLimit.resetAt - now > 60000) { // More than 1 minute to reset
                    logger.debug('Cannot process - insufficient rate limit', {
                        remaining: this.rateLimit.remaining,
                        needed: neededWithBuffer,
                        resetIn: Math.ceil((this.rateLimit.resetAt - now) / 1000)
                    });
                    return false;
                }
            }

            return true;
        } catch (error) {
            logger.error('Error checking if can process accounts:', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    convertToVxTwitter(url) {
        logger.debug('Converting Twitter URL to vxtwitter', { originalUrl: url });
        return url.replace(/(twitter\.com|x\.com)/, 'vxtwitter.com');
    }

    createTweetEmbed(tweet, authorData) {
        logger.debug('Creating tweet embed', { tweetId: tweet.id, author: authorData.username });
        const embed = new EmbedBuilder()
            .setColor('#1DA1F2')
            .setAuthor({
                name: `${authorData.name} (@${authorData.username})`,
                iconURL: authorData.profile_image_url,
                url: `https://twitter.com/${authorData.username}`
            })
            .setDescription(tweet.text)
            .setTimestamp(new Date(tweet.created_at))
            .setFooter({ text: 'Twitter' });

        // Only set image if media is available and has a valid URL
        if (tweet.attachments?.media_keys && tweet.media?.[0]?.url) {
            logger.debug('Adding media to tweet embed', { 
                tweetId: tweet.id,
                mediaUrl: tweet.media[0].url
            });
            embed.setImage(tweet.media[0].url);
        }

        return embed;
    }

    createOriginalUrlButton(tweetId, authorUsername) {
        logger.debug('Creating original URL button', { tweetId, author: authorUsername });
        const button = new ButtonBuilder()
            .setLabel('Open in Twitter')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://twitter.com/${authorUsername}/status/${tweetId}`);

        return new ActionRowBuilder().addComponents(button);
    }

    async handleRateLimit() {
        const now = Date.now();
        const state = {
            now,
            timeSinceLastRequest: now - this.lastRequestTime,
            remaining: this.rateLimit.remaining,
            resetAt: this.rateLimit.resetAt,
            requestCount: this.requestCount,
            backoffTime: this.backoffTime
        };

        logger.debug('Rate limit check started', state);

        // Ensure minimum time between requests
        if (state.timeSinceLastRequest < this.minRequestInterval) {
            const waitTime = this.minRequestInterval - state.timeSinceLastRequest;
            logger.debug(`Enforcing minimum request interval`, {
                waitTime,
                lastRequest: new Date(this.lastRequestTime).toISOString()
            });
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        // Check if we've exceeded our conservative request limit
        if (state.requestCount >= this.maxRequestsPerBatch) {
            logger.warn('Request batch limit reached', {
                requestCount: state.requestCount,
                maxRequests: this.maxRequestsPerBatch,
                waitTime: this.batchInterval,
                nextBatchAt: new Date(now + this.batchInterval).toISOString()
            });

            // Wait for the configured batch interval
            await new Promise(resolve => setTimeout(resolve, this.batchInterval));
            
            // Reset batch counter and update last request time
            this.requestCount = 0;
            this.lastRequestTime = Date.now();
            
            logger.info('Batch limit reset after waiting', {
                newRequestCount: this.requestCount,
                nextBatchAvailable: new Date(this.lastRequestTime + this.batchInterval).toISOString()
            });
            return true;
        }
        
        // Check if rate limit has reset
        if (now >= state.resetAt) {
            logger.info('Rate limit reset triggered', {
                oldRemaining: state.remaining,
                oldResetAt: new Date(state.resetAt).toISOString(),
                newResetAt: new Date(now + 900000).toISOString()
            });
            this.rateLimit.remaining = 180;
            this.rateLimit.resetAt = now + 900000; // 15 minutes
            this.rateLimit.lastReset = now;
            this.backoffTime = 0;
            this.requestCount = 0;
            return true;
        }

        // Keep a buffer of requests
        if (state.remaining <= this.bufferThreshold) {
            const timeUntilReset = state.resetAt - now;
            logger.warn('Rate limit buffer threshold reached', {
                remaining: state.remaining,
                threshold: this.bufferThreshold,
                resetIn: Math.ceil(timeUntilReset / 1000),
                resetAt: new Date(state.resetAt).toISOString()
            });

            // Wait until reset plus a small buffer
            const waitTime = timeUntilReset + 5000; // Add 5 seconds buffer
            logger.info(`Waiting ${Math.ceil(waitTime/1000)} seconds for rate limit reset`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            
            // Reset our counters
            this.requestCount = 0;
            this.backoffTime = 0;
            this.rateLimit.remaining = 180;
            this.rateLimit.resetAt = Date.now() + 900000;
            
            logger.info('Rate limits reset, resuming operations', {
                remaining: this.rateLimit.remaining,
                resetAt: new Date(this.rateLimit.resetAt).toISOString()
            });
            return true;
        }

        // If we have remaining requests, proceed
        if (state.remaining > 0) {
            this.requestCount++;
            logger.debug('Rate limit check passed', {
                remaining: state.remaining - 1,
                requestCount: this.requestCount
            });
            return true;
        }

        // Calculate backoff time with exponential increase
        if (this.backoffTime === 0) {
            this.backoffTime = 10000; // Start with 10 seconds
        } else {
            this.backoffTime = Math.min(this.backoffTime * 2, 300000); // Max 5 minutes
        }

        logger.warn('Rate limit reached, implementing backoff', {
            backoffTime: this.backoffTime,
            resetIn: Math.ceil((this.rateLimit.resetAt - now) / 1000),
            remaining: this.rateLimit.remaining
        });

        await new Promise(resolve => setTimeout(resolve, this.backoffTime));
        return this.handleRateLimit();
    }

    async fetchTweets(account) {
        try {
            // Check rate limits before making request
            if (!await this.handleRateLimit()) {
                logger.warn(`Rate limit check failed for ${account.account_handle}, skipping`);
                return null;
            }

            logger.info(`Fetching tweets for account: ${account.account_handle}`, {
                lastTweetId: account.last_tweet_id
            });

            this.lastRequestTime = Date.now();
            const response = await this.api.get('/tweets/search/recent', {
                params: {
                    query: `from:${account.account_handle}`,
                    'tweet.fields': 'created_at,attachments',
                    'user.fields': 'profile_image_url',
                    'expansions': 'author_id,attachments.media_keys',
                    'media.fields': 'url,preview_image_url',
                    'since_id': account.last_tweet_id || undefined,
                    'max_results': 10 // Minimum allowed by Twitter API
                }
            });

            // Update rate limit info from response headers
            this.rateLimit.remaining = parseInt(response.headers['x-rate-limit-remaining'] || '0');
            this.rateLimit.resetAt = parseInt(response.headers['x-rate-limit-reset'] || '0') * 1000;

            logger.debug('Rate limit updated', {
                remaining: this.rateLimit.remaining,
                resetAt: new Date(this.rateLimit.resetAt).toISOString(),
                requestCount: this.requestCount
            });

            if (!response.data.data?.length) {
                logger.debug(`No new tweets found for ${account.account_handle}`);
                return null;
            }

            // Update last tweet ID
            const latestTweetId = response.data.data[0].id;
            await updateLastTweetId(account.account_handle, latestTweetId);
            logger.info(`Found ${response.data.data.length} new tweets for ${account.account_handle}`, {
                latestTweetId
            });

            // Process media attachments
            const mediaMap = new Map();
            if (response.data.includes?.media) {
                response.data.includes.media.forEach(media => {
                    mediaMap.set(media.media_key, media);
                });
            }

            // Add media to tweets
            return response.data.data.map(tweet => {
                if (tweet.attachments?.media_keys) {
                    tweet.media = tweet.attachments.media_keys.map(key => mediaMap.get(key));
                }
                return {
                    tweet,
                    author: response.data.includes.users.find(u => u.id === tweet.author_id),
                    media: tweet.media
                };
            });

        } catch (error) {
            if (error.response?.status === 429) {
                logger.warn(`Rate limit exceeded for ${account.account_handle}`, {
                    resetAt: error.response.headers['x-rate-limit-reset'],
                    retryAfter: error.response.headers['retry-after']
                });
                // Force a rate limit reset
                this.rateLimit.remaining = 0;
                this.rateLimit.resetAt = Date.now() + (parseInt(error.response.headers['retry-after'] || '900') * 1000);
                return null;
            }

            logger.error(`Error fetching tweets for ${account.account_handle}:`, {
                error: error.message,
                response: error.response?.data,
                stack: error.stack
            });
            return null;
        }
    }

    async verifyChannelConfigurations() {
        try {
            const guilds = await new Promise((resolve, reject) => {
                db.all(
                    'SELECT * FROM discord_channels WHERE twitter_channel_id IS NOT NULL',
                    (err, rows) => {
                        if (err) {
                            logger.error('Database error checking channel configurations:', {
                                error: err.message,
                                stack: err.stack
                            });
                            reject(err);
                            return;
                        }
                        logger.debug(`Found ${rows?.length || 0} guilds with Twitter channels configured`);
                        resolve(rows || []);
                    }
                );
            });
            return guilds;
        } catch (error) {
            logger.error('Error checking channel configurations:', {
                error: error.message,
                stack: error.stack
            });
            return [];
        }
    }

    async checkNewTweets() {
        logger.info('Starting new tweets check');
        
        try {
            // Verify database connection first
            await verifyDatabaseConnection();
            
            // Get all accounts and verify we have channels configured
            const [accounts, guilds] = await Promise.all([
                getAllTwitterAccounts(),
                this.verifyChannelConfigurations()
            ]);

            if (guilds.length === 0) {
            logger.info('No guilds have channels configured, skipping tweet check');
            return [];
        }

        logger.info(`Found ${accounts.length} accounts to check and ${guilds.length} configured guilds`, {
            accounts: accounts.map(a => ({
                handle: a.account_handle,
                lastTweetId: a.last_tweet_id
            })),
            guilds: guilds.map(g => ({
                guildId: g.guild_id,
                channelId: g.twitter_channel_id
            }))
        });
        
        const results = [];
        let processedAccounts = 0;

        // Process each account
        while (processedAccounts < accounts.length) {
            const account = accounts[processedAccounts];
            try {
                logger.info(`Processing account ${processedAccounts + 1}/${accounts.length}: ${account.account_handle}`, {
                    lastTweetId: account.last_tweet_id,
                    processedAccounts,
                    totalAccounts: accounts.length
                });
                
                // Check rate limits before fetching
                const rateLimitInfo = this.getRateLimitInfo();
                logger.debug('Current rate limit status:', {
                    remaining: rateLimitInfo.remaining,
                    resetAt: new Date(rateLimitInfo.resetAt).toISOString(),
                    backoffTime: rateLimitInfo.backoffTime,
                    requestCount: rateLimitInfo.requestCount
                });

                // Fetch tweets for this account
                const tweets = await this.fetchTweets(account);
                
                if (tweets && tweets.length > 0) {
                    logger.info(`Found ${tweets.length} new tweets for ${account.account_handle}`, {
                        lastTweetId: account.last_tweet_id,
                        newTweets: tweets.map(t => ({
                            id: t.tweet.id,
                            text: t.tweet.text.substring(0, 50) + '...',
                            createdAt: t.tweet.created_at
                        }))
                    });
                    
                    // Add account info to tweet data
                    const tweetsWithAccount = tweets.map(t => ({
                        ...t,
                        account: account.account_handle
                    }));
                    
                    results.push(...tweetsWithAccount);
                    
                    logger.debug(`Added ${tweets.length} tweets to results array`, {
                        totalResults: results.length,
                        account: account.account_handle
                    });
                } else {
                    logger.info(`No new tweets found for ${account.account_handle}`, {
                        lastTweetId: account.last_tweet_id,
                        account: account.account_handle
                    });
                }

                // Add delay between accounts
                if (processedAccounts < accounts.length - 1) {
                    logger.debug(`Waiting ${this.minRequestInterval/1000} seconds before processing next account`, {
                        currentAccount: account.account_handle,
                        processedAccounts,
                        totalAccounts: accounts.length,
                        delayMs: this.minRequestInterval
                    });
                    await new Promise(resolve => setTimeout(resolve, this.minRequestInterval));
                }
                processedAccounts++;

            } catch (error) {
                logger.error(`Error processing account ${account.account_handle}:`, {
                    error: error.message,
                    stack: error.stack,
                    processedAccounts,
                    totalAccounts: accounts.length
                });
                processedAccounts++; // Skip this account and move to next
            }
        }

        logger.info(`Tweet check completed. Found ${results.length} new tweets total`, {
            processedAccounts,
            totalAccounts: accounts.length,
            tweetsFound: results.length
        });
        
        if (results.length > 0) {
            logger.debug('Tweet details:', {
                tweets: results.map(t => ({
                    account: t.account,
                    id: t.tweet.id,
                    text: t.tweet.text.substring(0, 50) + '...'
                }))
            });
        }
        
            return results;
        } catch (error) {
            logger.error('Error in checkNewTweets:', {
                error: error.message,
                stack: error.stack
            });
            return [];
        }
    }
}

module.exports = new TwitterIntegration();
